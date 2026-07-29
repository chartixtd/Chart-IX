"use client";

import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { useSpotTickers } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { useMarketStore } from "@/stores/market";
import { useFavoritesStore } from "@/stores/favorites";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { MarketHeatmap } from "@/components/trade/MarketHeatmap";
import type { BingXTicker } from "@/types/bingx";

const WS_SUBSCRIBE_LIMIT = 30;
/** 每行的估计高度（px）。未测出真实高度前用它算窗口范围，测出后即被替换。 */
const ESTIMATED_ROW_HEIGHT = 32;
/** 视口上下各多渲染几行，避免快速滚动时先看到空白 */
const OVERSCAN = 8;

interface MarketOverviewProps {
  onSelectSymbol?: (symbol: string) => void;
  activeSymbol?: string;
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

export function MarketOverview({ onSelectSymbol, activeSymbol = "" }: MarketOverviewProps) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "heatmap">("list");
  const { data: tickers, isLoading } = useSpotTickers();
  const favorites = useFavoritesStore((s) => s.favorites);

  const wsSymbols = useMemo(() => {
    if (!tickers) return [];
    return tickers.slice(0, WS_SUBSCRIBE_LIMIT).map((t) => t.symbol);
  }, [tickers]);

  useBingXWebSocket(wsSymbols);

  const searchLower = search.toLowerCase();
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
            列表
          </button>
          <button
            onClick={() => setViewMode("heatmap")}
            className={cn(
              "flex-1 rounded-xs py-1 text-xs font-medium transition-colors",
              viewMode === "heatmap" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            热力图
          </button>
        </div>
      </div>
      {viewMode === "heatmap" ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <MarketHeatmap />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
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
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto custom-scrollbar"
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
