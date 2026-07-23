"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { useSpotTickers } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import type { BingXTicker } from "@/types/bingx";

const WS_SUBSCRIBE_LIMIT = 30;
const VISIBLE_LIMIT = 50;

interface MarketOverviewProps {
  onSelectSymbol?: (symbol: string) => void;
  activeSymbol?: string;
}

// Memoized ticker row — only re-renders when its own ticker data changes
const TickerRow = memo(function TickerRow({
  ticker,
  isActive,
  onClick,
}: {
  ticker: BingXTicker;
  isActive: boolean;
  onClick: () => void;
}) {
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
  return (
    <button
      onClick={onClick}
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
  const { data: tickers, isLoading } = useSpotTickers();

  const wsSymbols = useMemo(() => {
    if (!tickers) return [];
    return tickers.slice(0, WS_SUBSCRIBE_LIMIT).map((t) => t.symbol);
  }, [tickers]);

  useBingXWebSocket(wsSymbols);

  const searchLower = search.toLowerCase();
  const filtered = useMemo(() => {
    if (!tickers) return [];
    if (!searchLower) return tickers.slice(0, VISIBLE_LIMIT);
    return tickers.filter((t) => t.symbol.toLowerCase().includes(searchLower)).slice(0, VISIBLE_LIMIT);
  }, [tickers, searchLower]);

  const handleSelect = useCallback(
    (symbol: string) => onSelectSymbol?.(symbol),
    [onSelectSymbol]
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
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="grid grid-cols-3 gap-1 px-3 pb-2 text-xs text-text-muted">
          <span>Symbol</span>
          <span className="text-right">Price</span>
          <span className="text-right">24h</span>
        </div>
        {isLoading && <LoadingDummy />}
        {filtered.map((ticker) => (
          <TickerRow
            key={ticker.symbol}
            ticker={ticker}
            isActive={ticker.symbol === activeSymbol}
            onClick={() => handleSelect(ticker.symbol)}
          />
        ))}
      </div>
    </div>
  );
}
