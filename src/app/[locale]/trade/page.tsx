"use client";

import { useState, memo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { MarketOverview } from "@/components/trade/MarketOverview";
import { OrderBook } from "@/components/trade/OrderBook";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { MobileTradeBar } from "./MobileTradeBar";

// lightweight-charts is a large canvas-based dependency — split into its own
// chunk instead of shipping it in the initial /trade bundle.
const KlineChart = dynamic(
  () => import("@/components/trade/KlineChart").then((m) => m.KlineChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">
        Loading chart…
      </div>
    ),
  }
);
import { FearGreedIndex } from "@/components/trade/FearGreedIndex";
import { OrderForm } from "@/components/trade/order-form/OrderForm";
import { OrdersPanel } from "@/components/trade/OrdersPanel";
import { PaperOrdersPanel } from "@/components/trade/PaperOrdersPanel";
import { FuturesInfoPanel } from "@/components/trade/FuturesInfoPanel";
import { FuturesWalletSummary } from "@/components/trade/FuturesWalletSummary";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { useChartOverlay } from "@/hooks/useChartOverlay";
import { useTradePrefsStore, type TradeMarketType } from "@/stores/tradePrefs";
import { formatPrice, formatPercent, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

// Mirrors BingX's supported kline intervals minus "1M" (monthly), which
// KlineChart's live-candle bucketing can't represent as a fixed-duration window.
// Which of these show as always-visible buttons vs. behind "更多" is per-user
// (see pinnedIntervals in stores/tradePrefs.ts).
const ALL_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"];
type MarketType = TradeMarketType;

// Memoized top bar — isolates ticker-driven re-renders from the rest of the page
const TickerBar = memo(function TickerBar({
  symbol,
  market,
  onMarketChange,
  onPickSymbol,
  locale,
  isPro,
  isLoggedIn,
  authLoading,
}: {
  symbol: string;
  market: MarketType;
  onMarketChange: (m: MarketType) => void;
  onPickSymbol?: () => void;
  locale: string;
  isPro: boolean;
  isLoggedIn: boolean;
  authLoading: boolean;
}) {
  const t = useTranslations("trade");
  const { data: ticker } = useSpotTicker(symbol);
  const isPositive = ticker ? parseFloat(ticker.priceChangePercent) >= 0 : false;

  return (
    <div className="flex items-center gap-4 border-b border-border-default px-4 py-3 overflow-x-auto">
      <div className="flex shrink-0 rounded-xs bg-bg-tertiary p-0.5">
        <button
          onClick={() => onMarketChange("spot")}
          className={cn(
            "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
            market === "spot" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
          )}
        >
          Spot
        </button>
        {!authLoading && (
          isLoggedIn ? (
            <button
              onClick={() => onMarketChange("paper")}
              className={cn(
                "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                market === "paper" ? "bg-bg-primary text-gold" : "text-text-muted hover:text-text-secondary"
              )}
            >
              模拟盘
            </button>
          ) : (
            <Link
              href={`/${locale}/login`}
              className="rounded-xs px-3 py-1 text-xs font-medium text-text-muted hover:text-gold transition-colors"
              title="登录后可用"
            >
              模拟盘
              <span className="ml-1 opacity-60">&#x1F512;</span>
            </Link>
          )
        )}
        {!authLoading && (
          isPro ? (
            <button
              onClick={() => onMarketChange("futures")}
              className={cn(
                "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                market === "futures" ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
              )}
            >
              Futures
            </button>
          ) : (
            <Link
              href={`/${locale}/upgrade`}
              className="rounded-xs px-3 py-1 text-xs font-medium text-text-muted hover:text-gold transition-colors"
              title={t("futures.pro_required")}
            >
              Futures
              <span className="ml-1 opacity-60">&#x1F512;</span>
            </Link>
          )
        )}
      </div>

      <div className="hidden h-4 w-px bg-border-default sm:block" />

      <button
        onClick={onPickSymbol}
        className={cn("flex shrink-0 items-center gap-3", onPickSymbol && "lg:pointer-events-none")}
      >
        <h2 className="font-display text-lg tracking-tight">{symbol}</h2>
        {onPickSymbol && <span className="text-xs text-text-muted lg:hidden">{t("mobile_symbol_picker")} ▾</span>}
      </button>
      {ticker && (
        <>
          <span className={cn("shrink-0 font-mono text-xl font-semibold tabular-nums", isPositive ? "text-success" : "text-danger")}>
            {formatPrice(Number(ticker.lastPrice))}
          </span>
          <Badge variant={isPositive ? "green" : "red"}>
            {formatPercent(parseFloat(ticker.priceChangePercent))}
          </Badge>
          <SetAlertButton symbol={symbol} currentPrice={Number(ticker.lastPrice)} />
          <div className="ml-auto hidden shrink-0 items-center gap-4 text-xs text-text-secondary lg:flex">
            <span>24h High: <span className="font-mono text-text-primary tabular-nums">{formatPrice(parseFloat(ticker.highPrice))}</span></span>
            <span>24h Low: <span className="font-mono text-text-primary tabular-nums">{formatPrice(parseFloat(ticker.lowPrice))}</span></span>
            <span>Vol: <span className="font-mono text-text-primary tabular-nums">{formatNumber(parseFloat(ticker.volume), 0)}</span></span>
          </div>
        </>
      )}
    </div>
  );
});

// Set a price alert for the current symbol
const SetAlertButton = memo(function SetAlertButton({ symbol, currentPrice }: { symbol: string; currentPrice: number }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const addAlert = usePriceAlertsStore((s) => s.addAlert);

  const handleOpen = () => {
    setPrice(currentPrice > 0 ? currentPrice.toString() : "");
    setOpen(true);
  };

  const handleConfirm = () => {
    const target = parseFloat(price);
    if (!target || target <= 0) return;
    addAlert(symbol, target, direction);
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="shrink-0 rounded-xs px-1.5 py-1 text-text-muted hover:bg-bg-tertiary hover:text-gold"
        title="设置价格提醒"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`价格提醒 · ${symbol}`} size="sm">
        <div className="space-y-3">
          <div className="flex rounded-xs bg-bg-tertiary p-0.5 text-xs">
            <button
              onClick={() => setDirection("above")}
              className={cn("flex-1 rounded-xs py-1.5", direction === "above" ? "bg-bg-primary text-success" : "text-text-muted")}
            >
              涨到以上
            </button>
            <button
              onClick={() => setDirection("below")}
              className={cn("flex-1 rounded-xs py-1.5", direction === "below" ? "bg-bg-primary text-danger" : "text-text-muted")}
            >
              跌到以下
            </button>
          </div>
          <Input placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
          <p className="text-xs text-text-muted">提醒只在你打开网站时以站内通知的形式出现，不会发邮件或推送。</p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" size="sm" onClick={handleConfirm}>设置提醒</Button>
          </div>
        </div>
      </Modal>
    </>
  );
});

// Memoized interval bar — user-pinned intervals as buttons, the rest behind a
// "more" dropdown where each entry can be starred to pin/unpin it. Pins persist
// per-user (zustand localStorage + PreferencesSync to Supabase).
const IntervalBar = memo(function IntervalBar({
  interval,
  onIntervalChange,
}: {
  interval: string;
  onIntervalChange: (i: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pinnedIntervals = useTradePrefsStore((s) => s.pinnedIntervals);
  const togglePinnedInterval = useTradePrefsStore((s) => s.togglePinnedInterval);

  // Keep the visible row in canonical (fast→slow) order regardless of pin order
  const pinnedInOrder = ALL_INTERVALS.filter((i) => pinnedIntervals.includes(i));
  const isPinned = pinnedInOrder.includes(interval);

  return (
    <div className="relative flex items-center px-3 py-1.5">
      <div className="flex items-center gap-1 overflow-x-auto">
        {pinnedInOrder.map((int) => (
          <button
            key={int}
            onClick={() => onIntervalChange(int)}
            className={cn(
              "min-h-[44px] rounded-xs px-2 text-xs font-medium transition-colors lg:min-h-0 lg:py-0.5",
              interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
            )}
          >
            {int}
          </button>
        ))}

        <button
          onClick={() => setMoreOpen((o) => !o)}
          className={cn(
            "min-h-[44px] rounded-xs px-2 text-xs font-medium transition-colors lg:min-h-0 lg:py-0.5",
            !isPinned ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
          )}
        >
          {!isPinned ? interval : "更多"} ▾
        </button>
      </div>

      {moreOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border-default bg-bg-secondary p-2 shadow-modal">
            <p className="mb-1 px-1 text-[11px] text-text-muted">点击星标固定到常用栏</p>
            <div className="grid grid-cols-4 gap-1">
              {ALL_INTERVALS.map((int) => {
                const pinned = pinnedIntervals.includes(int);
                return (
                  <div
                    key={int}
                    className={cn(
                      "flex items-center justify-between rounded-xs pl-1.5 pr-0.5 py-1 text-xs font-medium transition-colors",
                      interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
                    )}
                  >
                    <button
                      onClick={() => {
                        onIntervalChange(int);
                        setMoreOpen(false);
                      }}
                      className="flex-1 text-left"
                    >
                      {int}
                    </button>
                    <button
                      onClick={() => togglePinnedInterval(int)}
                      title={pinned ? "取消固定" : "固定到常用栏"}
                      className={cn(
                        "shrink-0 px-0.5 transition-colors",
                        pinned ? "text-gold" : "text-text-muted/50 hover:text-text-muted"
                      )}
                    >
                      {pinned ? "★" : "☆"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

/** 竖直方向的拖拽手柄——常态是一条细分隔线，hover/拖拽时高亮成金色并露出一个抓取提示点 */
function ResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-1 shrink-0 bg-border-default transition-colors hover:bg-gold/50 active:bg-gold">
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-2.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs bg-bg-tertiary opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-[8px] leading-none text-text-muted">⋮</span>
      </div>
    </PanelResizeHandle>
  );
}

export default function TradePage() {
  const locale = useLocale();
  const t = useTranslations("trade");
  const auth = useAuth();
  const symbol = useTradePrefsStore((s) => s.symbol);
  const setSymbol = useTradePrefsStore((s) => s.setSymbol);
  const interval = useTradePrefsStore((s) => s.interval);
  const setInterval = useTradePrefsStore((s) => s.setInterval);
  const market = useTradePrefsStore((s) => s.market);
  const setMarket = useTradePrefsStore((s) => s.setMarket);
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);
  const [initialSide, setInitialSide] = useState<"long" | "short" | undefined>();
  const [priceLinkSignal, setPriceLinkSignal] = useState<{ price: number; nonce: number } | null>(null);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [positionsSheetOpen, setPositionsSheetOpen] = useState(false);
  const [bookOverlayOpen, setBookOverlayOpen] = useState(false);
  // 用 JS 断点做「挂载哪一棵树」的决定，才能真正避免双挂载。
  // 仅用于外壳选择，SSR 阶段返回 false（先按手机渲染，避免桌面首屏闪大布局）
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useBingXWebSocket([symbol]);

  // 视口从手机跨到桌面断点时（窗口缩放、平板旋转、devtools 调整宽度），把手机端的
  // 三个 sheet 一并关掉——否则桌面布局挂载后，还开着的 sheet 会把 OrderForm/
  // FuturesInfoPanel/OrdersPanel 内容和桌面树同时挂载，重新引入本任务序列本来
  // 要消灭的双挂载问题（图表/WebSocket 订阅等带副作用的子树跑两份）。
  useEffect(() => {
    if (isDesktop) {
      setOrderSheetOpen(false);
      setPositionsSheetOpen(false);
      setBookOverlayOpen(false);
      setSymbolPickerOpen(false);
    }
  }, [isDesktop]);

  // URL 参数预填：从 screener 页面跳转时自动设置 symbol/market/side
  const searchParams = useSearchParams();
  useEffect(() => {
    const urlSymbol = searchParams.get("symbol");
    const urlMarket = searchParams.get("market") as TradeMarketType | null;
    const urlSide = searchParams.get("side") as "long" | "short" | null;
    if (urlSymbol) setSymbol(urlSymbol);
    if (urlMarket && (urlMarket === "spot" || urlMarket === "futures" || urlMarket === "paper")) {
      setMarket(urlMarket);
    }
    if (urlSide) setInitialSide(urlSide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 图表叠加：进出场标记 + 止盈止损/进场/强平价格线（按市场类型聚合）
  const { tradeMarkers, priceLines } = useChartOverlay(symbol, market);

  const isPro = auth.tier === "pro";
  const isLoggedIn = !!auth.userId;

  const handleSymbolSelect = useCallback((s: string) => { setSymbol(s); setSymbolPickerOpen(false); }, []);
  const handleIntervalChange = useCallback((i: string) => setInterval(i), []);
  const handleMarketChange = useCallback((m: MarketType) => setMarket(m), []);
  const openSymbolPicker = useCallback(() => setSymbolPickerOpen(true), []);
  const handleOrderBookPriceClick = useCallback((price: number) => {
    setPriceLinkSignal({ price, nonce: Date.now() });
  }, []);

  // key={market}: 切换市场必须整体重挂载 OrderForm，否则同一实例会带着上一个市场的
  // state（尤其是杠杆）跨市场存活——模拟盘本地设置的杠杆数字会原样漏进合约表单。
  const tradePanel = (
    <OrderForm
      key={market}
      symbol={symbol}
      market={market}
      initialSide={initialSide}
      priceLinkSignal={priceLinkSignal}
    />
  );

  const ordersPanel =
    market === "spot" ? <OrdersPanel symbol={symbol} />
    : market === "paper" ? <PaperOrdersPanel symbol={symbol} />
    : <FuturesInfoPanel symbol={symbol} />;

  // 桌面与手机共用同一个图表实例。此前两套布局各挂一个 KlineChart，
  // 等于同时跑两份 lightweight-charts 画布和两份 kline 订阅。
  const chartBlock = (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center border-b border-border-default">
        <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
        <div className="ml-auto pr-2">
          <FearGreedIndex compact />
        </div>
      </div>
      <div className="flex-1">
        <KlineChart
          symbol={symbol}
          interval={interval}
          className="h-full"
          tradeMarkers={tradeMarkers}
          priceLines={priceLines}
        />
      </div>
    </div>
  );

  return (
    // 手机上 100vh 会被 Safari 的地址栏高度算错，用 dvh；
    // 底部还要给手机 header 的顶部安全区和 L1 tab bar（含其底部安全区）让位——
    // desktop 分支的 4rem 不受影响，因为 <main> 在 lg 断点上没有这两块 padding
    <div className="flex h-[calc(100dvh-3rem-env(safe-area-inset-top)-70px-env(safe-area-inset-bottom))] flex-col lg:h-[calc(100dvh-4rem)]">
      <TickerBar
        symbol={symbol}
        market={market}
        onMarketChange={handleMarketChange}
        onPickSymbol={openSymbolPicker}
        locale={locale}
        isPro={isPro}
        isLoggedIn={isLoggedIn}
        authLoading={auth.loading}
      />

      {/* Desktop layout: draggable 4-column layout.
          isDesktop 由 useMediaQuery 的真实 JS 判断门控——不再靠 CSS
          hidden/lg:flex 让两套布局同时挂载，这正是 Task 3 遗留、本任务要解决的
          双挂载问题（图表、WebSocket 订阅等带副作用的子树不能跑两份）。 */}
      {isDesktop && (
        <div className="flex flex-1 overflow-hidden">
        {/* v2：去掉了独立盘口栏（并入 MarketOverview 的"盘口"切换），改版 id
            避免旧用户浏览器里存的 3 栏→4 栏比例套用到现在的 3 栏布局上 */}
        <PanelGroup direction="horizontal" autoSaveId="chart-ix-trade-layout-v2" className="flex-1">
          <Panel defaultSize={20} minSize={12} maxSize={30} className="border-r border-border-default">
            <MarketOverview
              onSelectSymbol={handleSymbolSelect}
              activeSymbol={symbol}
              onOrderBookPriceClick={handleOrderBookPriceClick}
            />
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={58} minSize={32}>
            {/* 持仓/挂单/历史/成交面板挤在最右侧窄栏里显示不全，改成图表下方的
                横向面板，宽度跟图表一致，字段能摆开——原来那一栏只留下单表单 */}
            <PanelGroup direction="vertical" autoSaveId="chart-ix-trade-chart-column">
              <Panel defaultSize={65} minSize={30}>
                {chartBlock}
              </Panel>

              <PanelResizeHandle className="group relative h-1 shrink-0 bg-border-default transition-colors hover:bg-gold/50 active:bg-gold">
                <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-2.5 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs bg-bg-tertiary opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-[8px] leading-none text-text-muted">⋯</span>
                </div>
              </PanelResizeHandle>

              <Panel defaultSize={35} minSize={20} className="border-t border-border-default">
                <div className="h-full overflow-auto">{ordersPanel}</div>
              </Panel>
            </PanelGroup>
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={22} minSize={16} maxSize={34}>
            <div className="flex h-full flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-auto">{tradePanel}</div>
              {market === "futures" && <div className="shrink-0"><FuturesWalletSummary /></div>}
            </div>
          </Panel>
        </PanelGroup>
        </div>
      )}

      {!isDesktop && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
            {chartBlock}
            {bookOverlayOpen && (
              // 订单簿做成图表上的叠层，而不是抢一个 tab
              <div className="absolute inset-y-0 right-0 w-[62%] border-l border-border-default bg-bg-primary/95 backdrop-blur-sm">
                <OrderBook symbol={symbol} onPriceClick={handleOrderBookPriceClick} />
              </div>
            )}
          </div>

          <MobileTradeBar
            onBuy={() => {
              setInitialSide("long");
              setOrderSheetOpen(true);
            }}
            onSell={() => {
              setInitialSide("short");
              setOrderSheetOpen(true);
            }}
            onTogglePositions={() => setPositionsSheetOpen((v) => !v)}
            onToggleBook={() => setBookOverlayOpen((v) => !v)}
            bookOpen={bookOverlayOpen}
            positionsOpen={positionsSheetOpen}
          />
        </div>
      )}

      <Modal
        open={orderSheetOpen}
        onClose={() => setOrderSheetOpen(false)}
        title={t("mobile_order_sheet")}
        variant="sheet"
      >
        <div className="-m-6">
          {tradePanel}
          {market === "futures" && <FuturesWalletSummary />}
        </div>
      </Modal>

      <Modal
        open={positionsSheetOpen}
        onClose={() => setPositionsSheetOpen(false)}
        title={t("mobile_positions")}
        variant="sheet"
      >
        <div className="-m-6 min-h-[40dvh]">{ordersPanel}</div>
      </Modal>

      {/* Mobile symbol picker */}
      <Modal
        open={symbolPickerOpen}
        onClose={() => setSymbolPickerOpen(false)}
        title={t("mobile_symbol_picker")}
        size="sm"
        variant="sheet"
        className="lg:hidden"
      >
        <div className="-m-6 h-[70dvh]">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </div>
      </Modal>
    </div>
  );
}
