"use client";

import {
  useState,
  useMemo,
  useCallback,
  useLayoutEffect,
  useDeferredValue,
  memo,
} from "react";
import { useTranslations } from "next-intl";
import { useSpotTickers } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { useMarketStore } from "@/stores/market";
import { useFavoritesStore } from "@/stores/favorites";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { OrderBook } from "@/components/trade/OrderBook";
import type { BingXTicker } from "@/types/bingx";

const WS_SUBSCRIBE_LIMIT = 30;
/** 每行的估计高度（px）。未测出真实高度前用它算窗口范围，测出后即被替换。 */
const ESTIMATED_ROW_HEIGHT = 32;
/** 视口上下各多渲染几行，避免快速滚动时先看到空白 */
const OVERSCAN = 8;

interface MarketOverviewProps {
  onSelectSymbol?: (symbol: string) => void;
  activeSymbol?: string;
  /** 盘口视图里点击某一档价格时回调，价格是解析后的 number */
  onOrderBookPriceClick?: (price: number) => void;
}

// Subscribes to its own symbol's live price — a tick only re-renders this one
// row, never the rest of the list. `fallback` (REST) is used until the first
// WebSocket update for this symbol arrives.
const TickerRow = memo(function TickerRow({
  symbol,
  fallback,
  isActive,
  onSelect,
  measureRef,
}: {
  symbol: string;
  fallback: BingXTicker;
  isActive: boolean;
  onSelect: (symbol: string) => void;
  measureRef?: (el: HTMLDivElement | null) => void;
}) {
  const live = useMarketStore((s) => s.tickers[symbol]);
  const ticker = live ?? fallback;
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
  const isFavorite = useFavoritesStore((s) => s.favorites.includes(symbol));
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const handleClick = useCallback(() => onSelect(symbol), [onSelect, symbol]);
  const handleStarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleFavorite(symbol);
    },
    [toggleFavorite, symbol]
  );

  return (
    <div
      ref={measureRef}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter") handleClick(); }}
      className={cn(
        "grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-1 px-3 py-1.5 text-xs transition-colors hover:bg-bg-tertiary cursor-pointer",
        isActive && "bg-gold/10 border-l-2 border-l-gold"
      )}
    >
      <button
        onClick={handleStarClick}
        className={cn(
          "shrink-0 text-sm leading-none",
          isFavorite ? "text-gold" : "text-text-muted/40 hover:text-text-muted"
        )}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        {isFavorite ? "★" : "☆"}
      </button>
      <span className="truncate text-left font-medium">{ticker.symbol}</span>
      <span className="text-right tabular-nums">{formatPrice(Number(ticker.lastPrice))}</span>
      <span
        className={cn(
          "w-16 text-right tabular-nums font-medium",
          isPositive ? "text-success" : "text-danger"
        )}
      >
        {formatPercent(parseFloat(ticker.priceChangePercent))}
      </span>
    </div>
  );
});

// Memoized loading skeleton
const LoadingDummy = memo(function LoadingDummy() {
  return (
    <div className="space-y-1 px-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-sm bg-bg-tertiary" />
      ))}
    </div>
  );
});

export function MarketOverview({ onSelectSymbol, activeSymbol = "", onOrderBookPriceClick }: MarketOverviewProps) {
  const t = useTranslations("trade");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "orderbook">("list");
  const { data: tickers, isLoading } = useSpotTickers();
  const favorites = useFavoritesStore((s) => s.favorites);

  const wsSymbols = useMemo(() => {
    if (!tickers) return [];
    return tickers.slice(0, WS_SUBSCRIBE_LIMIT).map((t) => t.symbol);
  }, [tickers]);

  useBingXWebSocket(wsSymbols);

  // BingX 现货/合约加起来近千个交易对，每敲一个字就全量过滤 + 重排会让输入框跟手感
  // 变差。用 deferred 值驱动列表：输入框自己永远即时响应，列表在空闲时追上来。
  const deferredSearch = useDeferredValue(search);
  const searchLower = deferredSearch.toLowerCase();
  const filtered = useMemo(() => {
    if (!tickers) return [];
    const matches = searchLower
      ? tickers.filter((t) => t.symbol.toLowerCase().includes(searchLower))
      : tickers;
    // Pin favorited symbols to the top, otherwise keep the incoming (REST) order.
    // 不再按数量裁剪——BingX 现货/合约都有近千个交易对，全部展示，靠下面的
    // 窗口化渲染（只渲染视口内的行）保证长列表滚动流畅。
    const favSet = new Set(favorites);
    return favSet.size
      ? [...matches].sort((a, b) => Number(favSet.has(b.symbol)) - Number(favSet.has(a.symbol)))
      : matches;
  }, [tickers, searchLower, favorites]);

  const handleSelect = useCallback(
    (symbol: string) => onSelectSymbol?.(symbol),
    [onSelectSymbol]
  );

  // 简易窗口化：不引入虚拟滚动依赖，按滚动位置只渲染视口内 + 少量缓冲的行。
  // 行高先用估计值起步，测到第一行的真实渲染高度后替换，避免样式变动时估计值跑偏。
  //
  // scrollEl 用回调 ref（而非普通 ref + 空依赖 useEffect）来接管：可滚动的容器只在
  // isLoading 变为 false 之后才会挂载（见下方 JSX），如果测量逻辑挂在一次性的
  // useEffect(() => {...}, []) 里，组件首次挂载时该 div 还不存在、el 是 null，
  // 之后 isLoading 翻转导致 div 真正出现时这个 effect 不会重新执行——
  // viewportHeight 永远停在初始值 0，窗口化只渲染出缓冲区那几行，下面全部留白
  // （2026-07-29 真实使用中发现：列表只显示 8 行左右，其余是空白）。
  // 回调 ref 在 DOM 节点真正挂载/卸载时触发，不受这个时序影响。
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);

  useLayoutEffect(() => {
    if (!scrollEl) return;
    const measure = () => setViewportHeight(scrollEl.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  const measureFirstRow = useCallback((el: HTMLDivElement | null) => {
    if (el) setRowHeight(el.getBoundingClientRect().height || ESTIMATED_ROW_HEIGHT);
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIndex = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN
  );
  const visibleRows = filtered.slice(startIndex, endIndex);
  const topPadding = startIndex * rowHeight;
  const bottomPadding = Math.max(0, (filtered.length - endIndex) * rowHeight);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3 space-y-2">
        <Input
          placeholder="Search symbol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-xs"
        />
        <div className="flex rounded-xs bg-bg-tertiary p-0.5">
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "flex-1 rounded-xs py-1 text-xs font-medium transition-colors",
              viewMode === "list" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t("market_overview.list")}
          </button>
          <button
            onClick={() => setViewMode("orderbook")}
            className={cn(
              "flex-1 rounded-xs py-1 text-xs font-medium transition-colors",
              viewMode === "orderbook" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t("market_overview.orderbook")}
          </button>
        </div>
      </div>
      {viewMode === "orderbook" ? (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <OrderBook symbol={activeSymbol} onPriceClick={onOrderBookPriceClick} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-1 px-3 pb-2 text-xs text-text-muted shrink-0">
            <span className="w-4" />
            <span>Symbol</span>
            <span className="text-right">Price</span>
            <span className="w-16 text-right">24h</span>
          </div>
          {isLoading ? (
            <LoadingDummy />
          ) : (
            <div
              ref={setScrollEl}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
            >
              <div style={{ height: topPadding }} />
              {visibleRows.map((ticker, i) => (
                <TickerRow
                  key={ticker.symbol}
                  symbol={ticker.symbol}
                  fallback={ticker}
                  isActive={ticker.symbol === activeSymbol}
                  onSelect={handleSelect}
                  measureRef={i === 0 ? measureFirstRow : undefined}
                />
              ))}
              <div style={{ height: bottomPadding }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
