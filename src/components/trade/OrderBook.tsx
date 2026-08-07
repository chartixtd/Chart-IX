"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { useOrderBook } from "@/hooks/useMarketData";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface OrderBookProps {
  symbol: string;
  /** 点击某一行价格时回调，价格是解析后的 number。不传则价格行不可点击。 */
  onPriceClick?: (price: number) => void;
}

export const OrderBook = memo(function OrderBook({ symbol, onPriceClick }: OrderBookProps) {
  const t = useTranslations("trading");
  const { data, isLoading, isPlaceholderData } = useOrderBook(symbol, 8);

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

  const renderRow = (price: string, qty: string, i: number, side: "ask" | "bid") => {
    const volume = parseFloat(qty);
    const widthPercent = maxTotal > 0 ? (volume / maxTotal) * 100 : 0;
    const priceColor = side === "ask" ? "text-danger" : "text-success";
    const barColor = side === "ask" ? "bg-danger/10" : "bg-success/10";

    const priceCell = (
      <span className={cn("relative z-10", priceColor)}>{formatPrice(parseFloat(price))}</span>
    );

    return (
      <div key={`${side}-${i}`} className="grid grid-cols-3 gap-1 px-2 py-0.5 relative">
        <div className={cn("absolute inset-y-0 right-0", barColor)} style={{ width: `${widthPercent}%` }} />
        {onPriceClick ? (
          <button
            type="button"
            onClick={() => onPriceClick(parseFloat(price))}
            className={cn("relative z-10 text-left hover:underline", priceColor)}
            title={t("orderbook_fill_price")}
          >
            {formatPrice(parseFloat(price))}
          </button>
        ) : (
          priceCell
        )}
        <span className="relative z-10 text-right text-text-secondary">{qty}</span>
        <span className="relative z-10 text-right text-text-muted">{volume.toFixed(4)}</span>
      </div>
    );
  };

  return (
    <div className={cn("text-xs", isPlaceholderData && "opacity-60 transition-opacity")}>
      {/* Header */}
      <div className="grid grid-cols-3 gap-1 px-2 py-1.5 text-text-muted border-b border-border-default">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (Sell) */}
      {asks.map(([price, qty], i) => renderRow(price, qty, i, "ask"))}

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
      {bids.map(([price, qty], i) => renderRow(price, qty, i, "bid"))}
    </div>
  );
});
