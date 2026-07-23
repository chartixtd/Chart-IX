"use client";

import { useState, memo, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { MarketOverview } from "@/components/trade/MarketOverview";
import { KlineChart } from "@/components/trade/KlineChart";
import { TradeForm } from "@/components/trade/TradeForm";
import { OrdersPanel } from "@/components/trade/OrdersPanel";
import { OrderBook } from "@/components/trade/OrderBook";
import { FuturesTradeForm } from "@/components/trade/FuturesTradeForm";
import { FuturesInfoPanel } from "@/components/trade/FuturesInfoPanel";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { formatPrice, formatPercent, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

const DEFAULT_SYMBOL = "BTC-USDT";
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
type MarketType = "spot" | "futures";

// Memoized top bar — isolates ticker-driven re-renders from the rest of the page
const TickerBar = memo(function TickerBar({
  symbol,
  market,
  onMarketChange,
  locale,
  isPro,
  authLoading,
}: {
  symbol: string;
  market: MarketType;
  onMarketChange: (m: MarketType) => void;
  locale: string;
  isPro: boolean;
  authLoading: boolean;
}) {
  const t = useTranslations("trade");
  const { data: ticker } = useSpotTicker(symbol);
  const isPositive = ticker ? parseFloat(ticker.priceChangePercent) >= 0 : false;

  return (
    <div className="flex items-center gap-4 border-b border-border-default px-4 py-3">
      <div className="flex rounded-xs bg-bg-tertiary p-0.5">
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

      <div className="w-px h-4 bg-border-default" />

      <h2 className="text-lg font-bold">{symbol}</h2>
      {ticker && (
        <>
          <span className={cn("text-xl font-bold tabular-nums", isPositive ? "text-success" : "text-danger")}>
            {formatPrice(parseFloat(ticker.lastPrice))}
          </span>
          <Badge variant={isPositive ? "green" : "red"}>
            {formatPercent(parseFloat(ticker.priceChangePercent))}
          </Badge>
          <div className="ml-auto flex items-center gap-4 text-xs text-text-secondary">
            <span>24h High: <span className="text-text-primary">{formatPrice(parseFloat(ticker.highPrice))}</span></span>
            <span>24h Low: <span className="text-text-primary">{formatPrice(parseFloat(ticker.lowPrice))}</span></span>
            <span>Vol: <span className="text-text-primary">{formatNumber(parseFloat(ticker.volume), 0)}</span></span>
          </div>
        </>
      )}
    </div>
  );
});

// Memoized interval bar
const IntervalBar = memo(function IntervalBar({
  interval,
  onIntervalChange,
}: {
  interval: string;
  onIntervalChange: (i: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border-default px-3 py-1.5">
      {INTERVALS.map((int) => (
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
            "flex-1 py-2 text-xs font-medium transition-colors",
            tab === key
              ? "text-text-primary border-b border-gold bg-bg-tertiary"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
});

export default function TradePage() {
  const locale = useLocale();
  const auth = useAuth();
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval] = useState("1h");
  const [market, setMarket] = useState<MarketType>("spot");
  const [rightTab, setRightTab] = useState<"trade" | "orders" | "book">("trade");

  useBingXWebSocket([symbol]);

  const isPro = auth.tier === "pro";

  const handleSymbolSelect = useCallback((s: string) => setSymbol(s), []);
  const handleIntervalChange = useCallback((i: string) => setInterval(i), []);
  const handleMarketChange = useCallback((m: MarketType) => setMarket(m), []);
  const handleTabChange = useCallback((t: string) => setRightTab(t as typeof rightTab), []);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <TickerBar
        symbol={symbol}
        market={market}
        onMarketChange={handleMarketChange}
        locale={locale}
        isPro={isPro}
        authLoading={auth.loading}
      />

      {/* Main grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left */}
        <div className="hidden w-60 shrink-0 border-r border-border-default lg:block">
          <MarketOverview onSelectSymbol={handleSymbolSelect} activeSymbol={symbol} />
        </div>

        {/* Center: Chart */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <IntervalBar interval={interval} onIntervalChange={handleIntervalChange} />
          <div className="flex-1">
            <KlineChart symbol={symbol} interval={interval} className="h-full" />
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-64 shrink-0 border-l border-border-default flex flex-col overflow-hidden">
          <RightTabs tab={rightTab} onTabChange={handleTabChange} />

          <div className="flex-1 overflow-hidden">
            {rightTab === "trade" && (
              market === "spot"
                ? <TradeForm symbol={symbol} />
                : <FuturesTradeForm symbol={symbol} />
            )}
            {rightTab === "orders" && (
              market === "spot"
                ? <OrdersPanel symbol={symbol} />
                : <FuturesInfoPanel symbol={symbol} />
            )}
            {rightTab === "book" && <OrderBook symbol={symbol} />}
          </div>
        </div>
      </div>
    </div>
  );
}
