"use client";

import { useState, useMemo } from "react";
import { useSpotTickers } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";

const WS_SUBSCRIBE_LIMIT = 30;

interface MarketOverviewProps {
  onSelectSymbol?: (symbol: string) => void;
  activeSymbol?: string;
}

export function MarketOverview({ onSelectSymbol, activeSymbol = "" }: MarketOverviewProps) {
  const [search, setSearch] = useState("");
  const { data: tickers, isLoading } = useSpotTickers();

  // 取前 N 个交易对订阅 WebSocket 实时行情
  const wsSymbols = useMemo(() => {
    if (!tickers) return [];
    return tickers.slice(0, WS_SUBSCRIBE_LIMIT).map((t) => t.symbol);
  }, [tickers]);

  // 订阅 WebSocket，数据自动写入 useMarketStore → useSpotTickers 返回合并结果
  useBingXWebSocket(wsSymbols);

  const filtered = tickers?.filter((t) =>
    t.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Input
          placeholder="Search symbol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 gap-1 px-3 pb-2 text-xs text-text-muted">
          <span>Symbol</span>
          <span className="text-right">Price</span>
          <span className="text-right">24h</span>
        </div>
        {isLoading && (
          <div className="space-y-1 px-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-sm bg-bg-tertiary" />
            ))}
          </div>
        )}
        {filtered?.slice(0, 50).map((ticker) => {
          const isActive = ticker.symbol === activeSymbol;
          const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
          return (
            <button
              key={ticker.symbol}
              onClick={() => onSelectSymbol?.(ticker.symbol)}
              className={cn(
                "grid w-full grid-cols-3 gap-1 px-3 py-1.5 text-xs transition-colors hover:bg-bg-tertiary",
                isActive && "bg-gold/10 border-l-2 border-l-gold"
              )}
            >
              <span className="truncate text-left font-medium">{ticker.symbol}</span>
              <span className="text-right tabular-nums">{formatPrice(parseFloat(ticker.lastPrice))}</span>
              <span
                className={cn(
                  "text-right tabular-nums font-medium",
                  isPositive ? "text-success" : "text-danger"
                )}
              >
                {formatPercent(parseFloat(ticker.priceChangePercent))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
