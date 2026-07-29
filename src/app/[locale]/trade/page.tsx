"use client";

import { useState, memo, useCallback, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { MarketOverview } from "@/components/trade/MarketOverview";
import { KlineChart } from "@/components/trade/KlineChart";
import { FearGreedIndex } from "@/components/trade/FearGreedIndex";
import { OrderForm } from "@/components/trade/order-form/OrderForm";
import { OrdersPanel } from "@/components/trade/OrdersPanel";
import { PaperOrdersPanel } from "@/components/trade/PaperOrdersPanel";
import { OrderBook } from "@/components/trade/OrderBook";
import { FuturesInfoPanel } from "@/components/trade/FuturesInfoPanel";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { useChartOverlay } from "@/hooks/useChartOverlay";
import { useTradePrefsStore, type TradeMarketType } from "@/stores/tradePrefs";
import { formatPrice, formatPercent, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

// Primary row shown as buttons; PRIMARY ⊂ ALL. ALL mirrors BingX's supported
// kline intervals minus "1M" (monthly), which KlineChart's live-candle bucketing
// can't represent as a fixed-duration window.
const PRIMARY_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
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
        {onPickSymbol && <span className="text-xs text-text-muted lg:hidden">切换 ▾</span>}
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

// Memoized interval bar — common intervals as buttons, the rest behind a "more" dropdown
const IntervalBar = memo(function IntervalBar({
  interval,
  onIntervalChange,
}: {
  interval: string;
  onIntervalChange: (i: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isPrimary = PRIMARY_INTERVALS.includes(interval);

  return (
    <div className="relative flex items-center gap-1 px-3 py-1.5">
      {PRIMARY_INTERVALS.map((int) => (
        <button
          key={int}
          onClick={() => onIntervalChange(int)}
          className={cn(
            "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
            interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
          )}
        >
          {int}
        </button>
      ))}

      <button
        onClick={() => setMoreOpen((o) => !o)}
        className={cn(
          "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
          !isPrimary ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
        )}
      >
        {!isPrimary ? interval : "更多"} ▾
      </button>

      {moreOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 grid w-48 grid-cols-4 gap-1 rounded-md border border-border-default bg-bg-secondary p-2 shadow-modal">
            {ALL_INTERVALS.map((int) => (
              <button
                key={int}
                onClick={() => {
                  onIntervalChange(int);
                  setMoreOpen(false);
                }}
                className={cn(
                  "rounded-xs py-1 text-center text-xs font-medium transition-colors",
                  interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
                )}
              >
                {int}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

// Memoized right panel tabs
const RightTabs = memo(function RightTabs({
  tab,
  onTabChange,
}: {
  tab: string;
  onTabChange: (t: string) => void;
}) {
  const t = useTranslations("trade");
  const tabs = [
    { key: "trade", label: t("market.trade") },
    { key: "orders", label: "Orders" },
    { key: "book", label: t("market.order_book") },
  ] as const;

  return (
    <div className="flex border-b border-border-default">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={cn(
            "relative flex-1 py-2 text-xs font-medium transition-colors duration-200",
            tab === key
              ? "text-text-primary"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          {label}
          {tab === key && (
            <span className="absolute inset-x-0 -bottom-px h-px animate-scale-in bg-gold" />
          )}
        </button>
      ))}
    </div>
  );
});

export default function TradePage() {
  const locale = useLocale();
  const auth = useAuth();
  const symbol = useTradePrefsStore((s) => s.symbol);
  const setSymbol = useTradePrefsStore((s) => s.setSymbol);
  const interval = useTradePrefsStore((s) => s.interval);
  const setInterval = useTradePrefsStore((s) => s.setInterval);
  const market = useTradePrefsStore((s) => s.market);
  const setMarket = useTradePrefsStore((s) => s.setMarket);
  const rightTab = useTradePrefsStore((s) => s.rightTab);
  const setRightTab = useTradePrefsStore((s) => s.setRightTab);
  const [mobileTab, setMobileTab] = useState<"chart" | "trade" | "book">("chart");
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);
  const [initialSide, setInitialSide] = useState<"long" | "short" | undefined>();

  useBingXWebSocket([symbol]);

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
  const handleTabChange = useCallback((t: string) => setRightTab(t as typeof rightTab), []);
  const openSymbolPicker = useCallback(() => setSymbolPickerOpen(true), []);

  // key={market}: 切换市场必须整体重挂载 OrderForm，否则同一实例会带着上一个市场的
  // state（尤其是杠杆）跨市场存活——模拟盘本地设置的杠杆数字会原样漏进合约表单。
  const tradePanel = <OrderForm key={market} symbol={symbol} market={market} initialSide={initialSide} />;

  const ordersPanel =
    market === "spot" ? <OrdersPanel symbol={symbol} />
    : market === "paper" ? <PaperOrdersPanel symbol={symbol} />
    : <FuturesInfoPanel symbol={symbol} />;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
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

      {/* Desktop layout: fixed 3-column grid */}
      <div className="hidden flex-1 overflow-hidden lg:flex">
        <div className="w-60 shrink-0 border-r border-border-default">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center border-b border-border-default">
            <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
            <div className="ml-auto pr-2">
              <FearGreedIndex compact />
            </div>
          </div>
          <div className="flex-1">
            <KlineChart symbol={symbol} interval={interval} className="h-full" tradeMarkers={tradeMarkers} priceLines={priceLines} />
          </div>
        </div>

        <div className="w-64 shrink-0 border-l border-border-default flex flex-col overflow-hidden">
          <RightTabs tab={rightTab} onTabChange={handleTabChange} />
          <div className="flex-1 overflow-hidden">
            {rightTab === "trade" && tradePanel}
            {rightTab === "orders" && ordersPanel}
            {rightTab === "book" && <OrderBook symbol={symbol} />}
          </div>
        </div>
      </div>

      {/* Mobile layout: tab-switched single column */}
      <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
        <div className="flex border-b border-border-default">
          {([
            { key: "chart", label: "图表" },
            { key: "trade", label: "下单" },
            { key: "book", label: "订单簿" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={cn(
                "flex-1 py-2.5 text-sm font-medium transition-colors",
                mobileTab === key
                  ? "text-text-primary border-b-2 border-gold bg-bg-tertiary"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {mobileTab === "chart" && (
            <div className="flex h-full flex-col">
              <div className="flex items-center border-b border-border-default">
                <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
                <div className="ml-auto pr-2">
                  <FearGreedIndex compact />
                </div>
              </div>
              <div className="flex-1">
                <KlineChart symbol={symbol} interval={interval} className="h-full" tradeMarkers={tradeMarkers} priceLines={priceLines} />
              </div>
            </div>
          )}
          {mobileTab === "trade" && (
            <div className="flex h-full flex-col divide-y divide-border-default">
              <div className="shrink-0">{tradePanel}</div>
              <div className="min-h-[16rem] flex-1">{ordersPanel}</div>
            </div>
          )}
          {mobileTab === "book" && <OrderBook symbol={symbol} />}
        </div>
      </div>

      {/* Mobile symbol picker */}
      <Modal open={symbolPickerOpen} onClose={() => setSymbolPickerOpen(false)} title="选择交易对" size="sm" className="lg:hidden">
        <div className="-m-6 h-[70vh]">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </div>
      </Modal>
    </div>
  );
}
