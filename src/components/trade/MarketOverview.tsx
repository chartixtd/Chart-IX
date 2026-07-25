"use client";

import { useState, useMemo, useCallback, memo } from "react";
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
const VISIBLE_LIMIT = 50;

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
}: {
  symbol: string;
  fallback: BingXTicker;
  isActive: boolean;
  onSelect: (symbol: string) => void;
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
      <span className="text-right tabular-nums">{formatPrice(parseFloat(ticker.lastPrice))}</span>
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
    // Pin favorited symbols to the top, otherwise keep the incoming (REST) order
    const favSet = new Set(favorites);
    const sorted = favSet.size
      ? [...matches].sort((a, b) => Number(favSet.has(b.symbol)) - Number(favSet.has(a.symbol)))
      : matches;
    return sorted.slice(0, VISIBLE_LIMIT);
  }, [tickers, searchLower, favorites]);

  const handleSelect = useCallback(
    (symbol: string) => onSelectSymbol?.(symbol),
    [onSelectSymbol]
  );

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
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {viewMode === "heatmap" ? (
          <MarketHeatmap />
        ) : (
          <>
            <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-1 px-3 pb-2 text-xs text-text-muted">
              <span className="w-4" />
              <span>Symbol</span>
              <span className="text-right">Price</span>
              <span className="w-16 text-right">24h</span>
            </div>
            {isLoading && <LoadingDummy />}
            {filtered.map((ticker) => (
              <TickerRow
                key={ticker.symbol}
                symbol={ticker.symbol}
                fallback={ticker}
                isActive={ticker.symbol === activeSymbol}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
