"use client";

import { useEffect, useState, useCallback } from "react";
import { usePaperAccount, usePaperOrders, usePlacePaperOrder } from "@/hooks/usePaperTrading";
import { Spinner } from "@/components/ui/Spinner";
import { formatPrice, formatNumber, cn } from "@/lib/utils";
import { useSpotTicker } from "@/hooks/useMarketData";

interface PaperOrdersPanelProps {
  symbol: string;
}

interface PaperLimitOrderRow {
  id: string;
  account_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  status: "pending" | "filled" | "canceled";
  created_at: string;
  filled_at: string | null;
}

function PositionRow({ symbol, side, quantity, entryPrice, leverage, margin, liquidationPrice, onClose, closing }: {
  symbol: string; side: "long" | "short"; quantity: number; entryPrice: number;
  leverage: number; margin: number; liquidationPrice: number;
  onClose: (symbol: string) => void; closing: boolean;
}) {
  const { data: ticker } = useSpotTicker(symbol);
  const markPrice = ticker ? parseFloat(ticker.lastPrice) : entryPrice;
  // 未实现盈亏按仓位方向计算
  const pnl = side === "long"
    ? (markPrice - entryPrice) * quantity
    : (entryPrice - markPrice) * quantity;
  // 收益率基于占用保证金（含杠杆放大）
  const pnlPct = margin > 0 ? (pnl / margin) * 100 : 0;
  const isProfit = pnl >= 0;
  const isLong = side === "long";

  return (
    <div className="px-3 py-2 border-b border-border-default/50 last:border-0">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className={cn("rounded-xs px-1 py-0.5 text-[10px] font-bold", isLong ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
            {isLong ? "多 LONG" : "空 SHORT"}
          </span>
          <span className="font-semibold text-text-primary">{symbol}</span>
          <span className="text-gold">{leverage}x</span>
        </div>
        <button
          onClick={() => onClose(symbol)}
          disabled={closing}
          className="rounded-xs bg-danger/10 px-1.5 py-0.5 text-xs text-danger hover:bg-danger/20 disabled:opacity-50"
        >
          {closing ? "平仓中" : "平仓"}
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-text-muted">{formatNumber(quantity, 6)} @ {formatPrice(entryPrice)}</span>
        <span className={cn("font-medium", isProfit ? "text-success" : "text-danger")}>
          {isProfit ? "+" : ""}{formatPrice(pnl)} ({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-muted/70">
        <span>强平价 {formatPrice(liquidationPrice)}</span>
        <span>保证金 {formatPrice(margin)} USDT</span>
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
  const placePaperOrder = usePlacePaperOrder();
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const [limitOrders, setLimitOrders] = useState<PaperLimitOrderRow[]>([]);
  const [limitLoading, setLimitLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const positions = data?.positions ?? [];

  const handleClosePosition = async (pSymbol: string) => {
    if (currentPrice <= 0) return;
    const pos = positions.find((p) => p.symbol === pSymbol);
    if (!pos) return;
    setClosing(pSymbol);
    try {
      // 平仓 = 反向市价单，数量为整个仓位的名义价值；杠杆传 1 仅用于关闭
      const usdtValue = parseFloat(String(pos.quantity)) * currentPrice;
      await placePaperOrder.mutateAsync({
        symbol: pSymbol,
        side: pos.side === "long" ? "sell" : "buy",
        quoteAmount: usdtValue,
        leverage: pos.leverage,
      });
    } catch { /* ignore */ }
    setClosing(null);
  };

  const fetchLimitOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/paper/limit-orders");
      const json = await res.json();
      if (json.success) {
        setLimitOrders((json.data as PaperLimitOrderRow[]) ?? []);
      }
    } catch {
      // silently ignore
    } finally {
      setLimitLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLimitOrders();
    const interval = setInterval(fetchLimitOrders, 5_000);
    return () => clearInterval(interval);
  }, [fetchLimitOrders]);

  const handleCancelLimit = async (orderId: string) => {
    setCancelling(orderId);
    try {
      await fetch("/api/paper/limit-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", orderId }),
      });
    } catch { /* ignore */ }
    setCancelling(null);
    fetchLimitOrders();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Balance */}
      <div className="border-b border-border-default px-3 py-2.5">
        <div className="text-xs text-text-muted">模拟盘可用余额 / Available Balance</div>
        <div className="mt-0.5 text-lg font-bold text-text-primary">
          {data ? formatPrice(data.account.balance_usdt) : "—"} <span className="text-xs font-normal text-text-muted">USDT</span>
        </div>
      </div>

      {/* Positions */}
      <div className="overflow-auto">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">Positions ({positions.length})</span>
        </div>
        {positions.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">暂无持仓 / No open positions</p>
        ) : (
          positions.map((p) => (
            <PositionRow
              key={p.id}
              symbol={p.symbol}
              side={p.side}
              quantity={parseFloat(String(p.quantity))}
              entryPrice={parseFloat(String(p.entry_price))}
              leverage={p.leverage}
              margin={parseFloat(String(p.margin))}
              liquidationPrice={parseFloat(String(p.liquidation_price))}
              onClose={handleClosePosition}
              closing={closing === p.symbol}
            />
          ))
        )}
      </div>

      {/* Limit Orders */}
      <div className="border-t border-border-default">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">
            Limit Orders ({limitOrders.length})
          </span>
        </div>
        {limitLoading ? (
          <div className="flex items-center justify-center py-4">
            <Spinner className="h-4 w-4" />
          </div>
        ) : limitOrders.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No pending limit orders</p>
        ) : (
          <div className="max-h-40 overflow-auto divide-y divide-border-default/50">
            {limitOrders.map((lo) => (
              <div key={lo.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={cn("font-semibold", lo.side === "buy" ? "text-success" : "text-danger")}>
                    {lo.side === "buy" ? "B" : "S"}
                  </span>
                  <span className="text-text-primary">{lo.symbol}</span>
                  <span className="text-text-muted">{formatPrice(lo.price)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">{formatNumber(lo.quantity, 6)}</span>
                  <button
                    onClick={() => handleCancelLimit(lo.id)}
                    disabled={cancelling === lo.id}
                    className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                  >
                    {cancelling === lo.id ? "×" : "Cancel"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trade history for this symbol */}
      <div className="border-t border-border-default flex-1 overflow-auto">
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
