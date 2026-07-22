"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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

export default function TradePage() {
  const t = useTranslations("trade");
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval] = useState("1h");
  const [market, setMarket] = useState<MarketType>("spot");
  const [rightTab, setRightTab] = useState<"trade" | "orders" | "book">("trade");
  const { data: ticker } = useSpotTicker(symbol);

  useBingXWebSocket([symbol]);

  const isPositive = ticker ? parseFloat(ticker.priceChangePercent) >= 0 : false;

  const tabs: { key: typeof rightTab; label: string }[] = [
    { key: "trade", label: t("market.trade") },
    { key: "orders", label: "Orders" },
    { key: "book", label: t("market.order_book") },
  ];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-4 border-b border-border-default px-4 py-3">
        {/* Market toggle */}
        <div className="flex rounded-xs bg-bg-tertiary p-0.5">
          {(["spot", "futures"] as MarketType[]).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={cn(
                "rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                market === m ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {m === "spot" ? "Spot" : "Futures"}
            </button>
          ))}
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

      {/* Main grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left */}
        <div className="hidden w-60 shrink-0 border-r border-border-default lg:block">
          <MarketOverview onSelectSymbol={setSymbol} activeSymbol={symbol} />
        </div>

        {/* Center: Chart */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b border-border-default px-3 py-1.5">
            {INTERVALS.map((int) => (
              <button
                key={int}
                onClick={() => setInterval(int)}
                className={cn(
                  "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
                  interval === int ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
                )}
              >
                {int}
              </button>
            ))}
          </div>
          <div className="flex-1">
            <KlineChart symbol={symbol} interval={interval} className="h-full" />
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-64 shrink-0 border-l border-border-default flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border-default">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={cn(
                  "flex-1 py-2 text-xs font-medium transition-colors",
                  rightTab === key
                    ? "text-text-primary border-b border-gold bg-bg-tertiary"
                    : "text-text-muted hover:text-text-secondary"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
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
