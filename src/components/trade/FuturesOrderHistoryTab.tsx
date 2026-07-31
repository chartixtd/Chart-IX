"use client";

import { useFuturesOrderHistory } from "@/hooks/useTradingAccount";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  FILLED: "text-success",
  PARTIALLY_FILLED: "text-gold",
  CANCELLED: "text-text-muted",
  CANCELED: "text-text-muted",
  REJECTED: "text-danger",
  EXPIRED: "text-text-muted",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FuturesOrderHistoryTab() {
  const { data: orders = [], isLoading } = useFuturesOrderHistory();

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  if (orders.length === 0) {
    return <p className="px-3 py-4 text-xs text-text-muted text-center">No order history</p>;
  }

  return (
    <div className="divide-y divide-border-default/50">
      {orders.map((o) => (
        <div key={o.orderId} className="px-3 py-2 text-xs hover:bg-bg-hover/50">
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-text-primary font-medium">{o.symbol}</span>
              <span className={cn("font-semibold", o.positionSide === "LONG" ? "text-success" : "text-danger")}>
                {o.positionSide}
              </span>
              <span className="text-text-muted">{o.type}</span>
            </div>
            <span className={STATUS_COLORS[o.status] || "text-text-muted"}>{o.status}</span>
          </div>
          <div className="flex items-center justify-between text-text-muted">
            <span>
              {o.type === "MARKET" ? "MKT" : parseFloat(o.price).toFixed(4)} · {parseFloat(o.executedQty)}/{parseFloat(o.origQty)}
            </span>
            <span>{formatTime(o.time)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
