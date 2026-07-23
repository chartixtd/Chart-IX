"use client";

import { memo } from "react";
import { useOrderBook } from "@/hooks/useMarketData";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface OrderBookProps {
  symbol: string;
}

export const OrderBook = memo(function OrderBook({ symbol }: OrderBookProps) {
  const { data, isLoading } = useOrderBook(symbol, 8);

  if (isLoading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded-sm bg-bg-tertiary" />
        ))}
      </div>
    );
  }

  const asks = data?.asks?.slice(0, 8).reverse() || [];
  const bids = data?.bids?.slice(0, 8) || [];

  const maxTotal = Math.max(
    ...(bids.map(([, q]) => parseFloat(q)) || [0]),
    ...(asks.map(([, q]) => parseFloat(q)) || [0])
  );

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="grid grid-cols-3 gap-1 px-2 py-1.5 text-text-muted border-b border-border-default">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (Sell) */}
      {asks.map(([price, qty], i) => {
        const volume = parseFloat(qty);
        const widthPercent = maxTotal > 0 ? (volume / maxTotal) * 100 : 0;
        return (
          <div key={`ask-${i}`} className="grid grid-cols-3 gap-1 px-2 py-0.5 relative">
            <div
              className="absolute inset-y-0 right-0 bg-danger/10"
              style={{ width: `${widthPercent}%` }}
            />
            <span className="relative z-10 text-danger">{formatPrice(parseFloat(price))}</span>
            <span className="relative z-10 text-right text-text-secondary">{qty}</span>
            <span className="relative z-10 text-right text-text-muted">{volume.toFixed(4)}</span>
          </div>
        );
      })}

      {/* Spread */}
      <div className="border-y border-border-default px-2 py-1.5 text-center text-text-muted">
        {data ? (
          <span>
            Spread: {formatPrice(parseFloat(asks[0]?.[0] || "0") - parseFloat(bids[0]?.[0] || "0"))}
          </span>
        ) : (
          "—"
        )}
      </div>

      {/* Bids (Buy) */}
      {bids.map(([price, qty], i) => {
        const volume = parseFloat(qty);
        const widthPercent = maxTotal > 0 ? (volume / maxTotal) * 100 : 0;
        return (
          <div key={`bid-${i}`} className="grid grid-cols-3 gap-1 px-2 py-0.5 relative">
            <div
              className="absolute inset-y-0 right-0 bg-success/10"
              style={{ width: `${widthPercent}%` }}
            />
            <span className="relative z-10 text-success">{formatPrice(parseFloat(price))}</span>
            <span className="relative z-10 text-right text-text-secondary">{qty}</span>
            <span className="relative z-10 text-right text-text-muted">{volume.toFixed(4)}</span>
          </div>
        );
      })}
    </div>
  );
});
