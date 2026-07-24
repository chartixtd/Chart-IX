"use client";

import { usePaperAccount, usePaperOrders } from "@/hooks/usePaperTrading";
import { Spinner } from "@/components/ui/Spinner";
import { formatPrice, formatNumber, cn } from "@/lib/utils";
import { useSpotTicker } from "@/hooks/useMarketData";

interface PaperOrdersPanelProps {
  symbol: string;
}

function HoldingRow({ symbol, quantity, avgEntryPrice }: { symbol: string; quantity: number; avgEntryPrice: number }) {
  const { data: ticker } = useSpotTicker(symbol);
  const markPrice = ticker ? parseFloat(ticker.lastPrice) : avgEntryPrice;
  const pnl = (markPrice - avgEntryPrice) * quantity;
  const pnlPct = avgEntryPrice > 0 ? (pnl / (avgEntryPrice * quantity)) * 100 : 0;
  const isProfit = pnl >= 0;

  return (
    <div className="px-3 py-2 border-b border-border-default/50 last:border-0">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-text-primary">{symbol}</span>
        <span className="text-text-muted">{formatNumber(quantity, 6)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-text-muted">Avg. {formatPrice(avgEntryPrice)}</span>
        <span className={cn("font-medium", isProfit ? "text-success" : "text-danger")}>
          {isProfit ? "+" : ""}{formatPrice(pnl)} ({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PaperOrdersPanel({ symbol }: PaperOrdersPanelProps) {
  const { data, isLoading } = usePaperAccount();
  const { data: orders, isLoading: ordersLoading } = usePaperOrders(symbol);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const holdings = data?.holdings ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Balance */}
      <div className="border-b border-border-default px-3 py-2.5">
        <div className="text-xs text-text-muted">模拟盘可用余额 / Available Balance</div>
        <div className="mt-0.5 text-lg font-bold text-text-primary">
          {data ? formatPrice(data.account.balance_usdt) : "—"} <span className="text-xs font-normal text-text-muted">USDT</span>
        </div>
      </div>

      {/* Holdings */}
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">Holdings ({holdings.length})</span>
        </div>
        {holdings.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">暂无持仓 / No holdings yet</p>
        ) : (
          holdings.map((h) => (
            <HoldingRow key={h.id} symbol={h.symbol} quantity={h.quantity} avgEntryPrice={h.avg_entry_price} />
          ))
        )}
      </div>

      {/* Trade history for this symbol */}
      <div className="border-t border-border-default">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">Recent Fills</span>
        </div>
        {ordersLoading ? (
          <div className="flex items-center justify-center py-4">
            <Spinner className="h-4 w-4" />
          </div>
        ) : !orders?.length ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No recent trades</p>
        ) : (
          <div className="max-h-40 overflow-auto divide-y divide-border-default/50">
            {orders.map((order) => (
              <div key={order.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={cn("font-semibold", order.side === "buy" ? "text-success" : "text-danger")}>
                    {order.side === "buy" ? "B" : "S"}
                  </span>
                  <span className="text-text-primary">{formatNumber(order.quantity, 6)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">{formatPrice(order.price)}</span>
                  <span className="text-text-muted w-16 text-right">{formatTime(order.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
