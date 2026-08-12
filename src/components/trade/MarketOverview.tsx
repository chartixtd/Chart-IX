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
import { useSpotTickers, useFuturesTickers, useFuturesContracts } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { useMarketStore } from "@/stores/market";
import { useFavoritesStore } from "@/stores/favorites";
import type { TradeMarketType } from "@/stores/tradePrefs";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { OrderBook } from "@/components/trade/OrderBook";
import { RecentTrades } from "@/components/trade/RecentTrades";
import {
  classifyInstrument,
  formatInstrumentLabel,
  isContractOpen,
  hasUsableQuote,
  INSTRUMENT_CATEGORIES,
  type InstrumentCategory,
} from "@/lib/instruments";
import type { BingXTicker } from "@/types/bingx";
import { Icon } from "@/components/ui/Icon";
import { usePriceFlash } from "@/hooks/usePriceFlash";

const WS_SUBSCRIBE_LIMIT = 30;

/** 列表里的一行。行情可能缺席（休市），但品种本身始终要能被看到和搜到。 */
interface InstrumentRow {
  symbol: string;
  /** 展示名，代币化标的为 "XAU/USD" 这类友好名称，加密永续即 symbol 本身 */
  label: string;
  category: InstrumentCategory;
  /** 可用行情；休市或数据异常（见 hasUsableQuote）时为 undefined */
  ticker?: BingXTicker;
  /** 交易所标记为休市（外汇周末、美股非交易时段） */
  closed: boolean;
}
/** 每行的估计高度（px）。未测出真实高度前用它算窗口范围，测出后即被替换。 */
const ESTIMATED_ROW_HEIGHT = 32;
/** 视口上下各多渲染几行，避免快速滚动时先看到空白 */
const OVERSCAN = 8;

interface MarketOverviewProps {
  onSelectSymbol?: (symbol: string) => void;
  activeSymbol?: string;
  /** 盘口视图里点击某一档价格时回调，价格是解析后的 number */
  onOrderBookPriceClick?: (price: number) => void;
  /** 当前交易市场。合约市场（"futures"）里混了代币化商品/外汇/美股/指数
   *  （见 src/lib/instruments.ts），需要换一套交易对来源并按分类过滤；
   *  现货/模拟盘沿用原来的现货交易对列表。 */
  market?: TradeMarketType;
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
  label,
  closed,
}: {
  symbol: string;
  /** REST 快照行情。休市品种没有行情，此时为 undefined。 */
  fallback?: BingXTicker;
  isActive: boolean;
  onSelect: (symbol: string) => void;
  measureRef?: (el: HTMLDivElement | null) => void;
  /** 代币化商品/外汇/美股/指数的展示名（如 "XAU/USD"）；不传则显示原始 symbol。 */
  label?: string;
  /** 交易所标记为休市——与"有行情但数据异常"区分开，后者不打这个标 */
  closed?: boolean;
}) {
  const t = useTranslations("trade.market_overview");
  const live = useMarketStore((s) => s.tickers[symbol]);
  // WS 推来的那一条也要过一遍可用性判据：否则 openPrice=0 的坏数据会绕过
  // 列表侧的过滤，从实时通道重新把 +822096901% 灌回这一行。
  const ticker = hasUsableQuote(live) ? live : fallback;
  const flash = usePriceFlash(ticker ? Number(ticker.lastPrice) : undefined);
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
          isFavorite ? "text-gold" : "text-text-muted/70 hover:text-text-muted"
        )}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <Icon name="star" filled={isFavorite} className="h-4 w-4" />
      </button>
      <span className="truncate text-left font-medium">{label ?? symbol}</span>
      {ticker ? (
        <>
          {/* 价格变动闪烁：行情列表同时刷新十几行时，这是"这一行刚动了"的唯一线索。
              rounded-xs + 负外边距让高亮块贴着数字而不撑开行高。 */}
          <span
            className={cn(
              "-mx-1 rounded-xs px-1 text-right tabular-nums",
              flash === "up" && "animate-price-up",
              flash === "down" && "animate-price-down"
            )}
          >
            {formatPrice(Number(ticker.lastPrice))}
          </span>
          <span
            className={cn(
              "w-16 text-right tabular-nums font-medium",
              parseFloat(ticker.priceChangePercent) >= 0 ? "text-success" : "text-danger"
            )}
          >
            {formatPercent(parseFloat(ticker.priceChangePercent))}
          </span>
        </>
      ) : (
        <>
          <span className="text-right tabular-nums text-text-muted">—</span>
          <span className="w-16 text-right text-[10px] text-text-muted">
            {closed ? t("closed") : "—"}
          </span>
        </>
      )}
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

export function MarketOverview({ onSelectSymbol, activeSymbol = "", onOrderBookPriceClick, market = "spot" }: MarketOverviewProps) {
  const t = useTranslations("trade");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "orderbook" | "trades">("list");
  const [category, setCategory] = useState<"all" | InstrumentCategory>("all");
  // 合约市场混了代币化商品/外汇/美股/指数（见 src/lib/instruments.ts），
  // 这些标的只在合约侧上架，现货交易对列表里查不到——市场是 futures 时必须
  // 换一套来源，否则它们在选择器里永远不可见。
  const isFutures = market === "futures";
  const { data: spotTickers, isLoading: spotLoading } = useSpotTickers(!isFutures);
  const { data: futuresTickers, isLoading: futuresLoading } = useFuturesTickers(isFutures);
  const { data: contracts, isLoading: contractsLoading } = useFuturesContracts(isFutures);
  const isLoading = isFutures ? futuresLoading || contractsLoading : spotLoading;
  const favorites = useFavoritesStore((s) => s.favorites);

  /**
   * 合约市场的品种清单以 **合约接口** 为准，行情左连接上去。
   *
   * 这里曾经直接拿批量 ticker 当清单，导致休市品种整批消失：BingX 只为
   * status=1 的合约返回行情，周末的外汇（39 个里 33 个）、美股非交易时段
   * （352 个里 142 个）在 ticker 里根本不存在，用户在选择器里搜不到 EUR/USD
   * 这类主流品种。合约接口不受交易时段影响，始终列出全部 1006 个合约。
   */
  const rows = useMemo<InstrumentRow[]>(() => {
    if (!isFutures) {
      // 现货没有代币化标的，也没有休市概念，清单仍以行情为准。
      return (spotTickers ?? []).map((tk) => ({
        symbol: tk.symbol,
        label: tk.symbol,
        category: "crypto" as const,
        ticker: hasUsableQuote(tk) ? tk : undefined,
        closed: false,
      }));
    }

    const tickerBySymbol = new Map<string, BingXTicker>();
    const tickerOrder = new Map<string, number>();
    (futuresTickers ?? []).forEach((tk, i) => {
      tickerBySymbol.set(tk.symbol, tk);
      tickerOrder.set(tk.symbol, i);
    });

    const build = (symbol: string, displayName: string | undefined, closed: boolean): InstrumentRow => {
      const tk = tickerBySymbol.get(symbol);
      return {
        symbol,
        label: formatInstrumentLabel(symbol, displayName),
        category: classifyInstrument(symbol),
        ticker: hasUsableQuote(tk) ? tk : undefined,
        closed,
      };
    };

    // 开市品种保持 BingX 自己的行情排序（大致按热度），休市品种按合约顺序缀在后面，
    // 这样常用品种仍在顶部，不会被几百个休市美股冲散。
    const open: InstrumentRow[] = [];
    const closedRows: InstrumentRow[] = [];
    const seen = new Set<string>();

    for (const c of contracts ?? []) {
      seen.add(c.symbol);
      const closed = !isContractOpen(c.status);
      (closed ? closedRows : open).push(build(c.symbol, c.displayName, closed));
    }
    // 合约列表加载完之前（或万一有行情却没有对应合约）也不能让列表空着
    for (const tk of futuresTickers ?? []) {
      if (!seen.has(tk.symbol)) open.push(build(tk.symbol, undefined, false));
    }

    const orderOf = (symbol: string) => tickerOrder.get(symbol) ?? Number.MAX_SAFE_INTEGER;
    open.sort((a, b) => orderOf(a.symbol) - orderOf(b.symbol));

    return [...open, ...closedRows];
  }, [isFutures, spotTickers, futuresTickers, contracts]);

  // 只订阅有实时行情的品种——休市品种没有推送，占着订阅额度纯属浪费。
  const wsSymbols = useMemo(
    () => rows.filter((r) => r.ticker).slice(0, WS_SUBSCRIBE_LIMIT).map((r) => r.symbol),
    [rows]
  );

  useBingXWebSocket(wsSymbols);

  // BingX 现货/合约加起来近千个交易对，每敲一个字就全量过滤 + 重排会让输入框跟手感
  // 变差。用 deferred 值驱动列表：输入框自己永远即时响应，列表在空闲时追上来。
  const deferredSearch = useDeferredValue(search);
  const searchLower = deferredSearch.toLowerCase();
  const filtered = useMemo(() => {
    let matches = rows;
    if (isFutures && category !== "all") {
      matches = matches.filter((r) => r.category === category);
    }
    if (searchLower) {
      // 展示名也参与匹配，用户搜 "EUR/USD" 或 "GOLD" 都能命中，
      // 不必知道 NCFXEUR2USD-USDT 这种内部代号。
      matches = matches.filter(
        (r) =>
          r.symbol.toLowerCase().includes(searchLower) ||
          r.label.toLowerCase().includes(searchLower)
      );
    }
    // Pin favorited symbols to the top, otherwise keep the incoming (REST) order.
    // 不再按数量裁剪——BingX 现货/合约都有近千个交易对，全部展示，靠下面的
    // 窗口化渲染（只渲染视口内的行）保证长列表滚动流畅。
    const favSet = new Set(favorites);
    return favSet.size
      ? [...matches].sort((a, b) => Number(favSet.has(b.symbol)) - Number(favSet.has(a.symbol)))
      : matches;
  }, [rows, searchLower, favorites, isFutures, category]);

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
          <button
            onClick={() => setViewMode("trades")}
            className={cn(
              "flex-1 rounded-xs py-1 text-xs font-medium transition-colors",
              viewMode === "trades" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t("market_overview.trades")}
          </button>
        </div>
        {isFutures && viewMode === "list" && (
          <div className="flex gap-1 overflow-x-auto">
            {(["all", ...INSTRUMENT_CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "shrink-0 rounded-xs px-2 py-1 text-xs font-medium transition-colors",
                  category === c ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`market_overview.category.${c}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {viewMode === "orderbook" ? (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <OrderBook symbol={activeSymbol} onPriceClick={onOrderBookPriceClick} market={isFutures ? "futures" : "spot"} />
        </div>
      ) : viewMode === "trades" ? (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <RecentTrades symbol={activeSymbol} active={viewMode === "trades"} market={isFutures ? "futures" : "spot"} />
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
              {visibleRows.map((row, i) => (
                <TickerRow
                  key={row.symbol}
                  symbol={row.symbol}
                  fallback={row.ticker}
                  isActive={row.symbol === activeSymbol}
                  onSelect={handleSelect}
                  measureRef={i === 0 ? measureFirstRow : undefined}
                  label={row.label}
                  closed={row.closed}
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
