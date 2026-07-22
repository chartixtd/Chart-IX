"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { MarketOverview } from "@/components/trade/MarketOverview";
import { KlineChart } from "@/components/trade/KlineChart";
import { OrderBook } from "@/components/trade/OrderBook";
import { useSpotTicker } from "@/hooks/useMarketData";
import { formatPrice, formatPercent, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

const DEFAULT_SYMBOL = "BTC-USDT";
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function TradePage() {
  const t = useTranslations("trade");
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [interval, setInterval] = useState("1h");
  const { data: ticker } = useSpotTicker(symbol);

  const isPositive = ticker ? parseFloat(ticker.priceChangePercent) >= 0 : false;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar: symbol info */}
      <div className="flex items-center gap-4 border-b border-border-default px-4 py-3">
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
        {/* Left: Symbol list */}
        <div className="hidden w-60 shrink-0 border-r border-border-default lg:block">
          <MarketOverview onSelectSymbol={setSymbol} activeSymbol={symbol} />
        </div>

        {/* Center: Chart + order form */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Interval selector */}
          <div className="flex items-center gap-1 border-b border-border-default px-3 py-1.5">
            {INTERVALS.map((int) => (
              <button
                key={int}
                onClick={() => setInterval(int)}
                className={cn(
                  "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
                  interval === int
                    ? "bg-gold/20 text-gold"
                    : "text-text-muted hover:text-text-primary"
                )}
              >
                {int}
              </button>
            ))}
          </div>

          {/* Chart */}
          <div className="flex-1">
            <KlineChart symbol={symbol} interval={interval} className="h-full" />
          </div>
        </div>

        {/* Right: Order Book */}
        <div className="w-64 shrink-0 border-l border-border-default overflow-y-auto">
          <div className="border-b border-border-default px-3 py-2">
            <span className="text-xs font-medium text-text-secondary">{t("market.order_book")}</span>
          </div>
          <OrderBook symbol={symbol} />
        </div>
      </div>
    </div>
  );
}
