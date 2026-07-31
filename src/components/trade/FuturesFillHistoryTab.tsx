"use client";

import { useFuturesFillHistory } from "@/hooks/useTradingAccount";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FuturesFillHistoryTab() {
  const { data: fills = [], isLoading } = useFuturesFillHistory();

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  if (fills.length === 0) {
    return <p className="px-3 py-4 text-xs text-text-muted text-center">No fills</p>;
  }

  return (
    <div className="divide-y divide-border-default/50">
      {fills.map((f) => (
        <div key={`${f.orderId}-${f.tradeId ?? f.time}`} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-bg-hover/50">
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary font-medium">{f.symbol}</span>
            <span className={cn("font-semibold", f.side === "BUY" ? "text-success" : "text-danger")}>
              {f.side}
            </span>
            <span className="text-text-primary">{parseFloat(f.qty)}</span>
          </div>
          <div className="flex items-center gap-3 text-text-muted">
            <span>{parseFloat(f.price).toFixed(4)}</span>
            <span>{formatTime(f.time)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
