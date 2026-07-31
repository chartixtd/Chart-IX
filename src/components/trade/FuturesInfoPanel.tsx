"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { translateError } from "@/components/trade/order-form/OrderForm";

interface FuturesInfoPanelProps {
  /** Only used to pre-select which symbol's Close/Cancel error toasts read naturally; the
   *  list itself always shows every open futures position/order, not just this symbol. */
  symbol: string;
}

interface FuturesPosition {
  symbol: string;
  positionId: string;
  positionSide: "LONG" | "SHORT";
  positionAmt: string;
  unrealizedProfit: string;
  leverage: number;
  /** BingX's real field name for entry price on this endpoint — not entryPrice */
  avgPrice: string;
  markPrice: string;
  liquidationPrice: string;
  /** BingX returns isolated as a boolean here, not a marginType string */
  isolated: boolean;
}

interface FuturesOrder {
  symbol: string;
  orderId: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  executedQty: string;
  status: string;
  leverage: number;
}

interface FuturesBalance {
  availableMargin: string;
  equity: string;
}

export function FuturesInfoPanel({ symbol }: FuturesInfoPanelProps) {
  const t = useTranslations();
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [orders, setOrders] = useState<FuturesOrder[]>([]);
  const [balance, setBalance] = useState<FuturesBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [amending, setAmending] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // No symbol filter: this panel is the account-wide "everything I have open"
      // view, not scoped to whichever symbol the chart happens to be on.
      const [posRes, ordRes, balRes] = await Promise.all([
        fetch(`/api/bingx/futures/positions`),
        fetch(`/api/bingx/futures/open-orders`),
        fetch(`/api/bingx/futures/positions?type=balance`),
      ]);
      const p = await posRes.json();
      const o = await ordRes.json();
      const b = await balRes.json();
      if (p.success) setPositions(p.data || []);
      if (o.success) setOrders(Array.isArray(o.data) ? o.data : o.data?.orders || []);
      if (b.success && b.data) setBalance(b.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCancel = async (order: FuturesOrder) => {
    setCancelling(order.orderId);
    await fetch("/api/bingx/futures/open-orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", symbol: order.symbol, orderId: order.orderId }),
    });
    setCancelling(null);
    fetchData();
  };

  const isModifiable = (type: string) =>
    type === "LIMIT" || type === "STOP" || type === "STOP_MARKET";

  const isConditionalOrder = (type: string) =>
    type === "STOP" || type === "STOP_MARKET";

  const startEdit = (order: FuturesOrder) => {
    setEditValue(order.price);
    setEditing(order.orderId);
  };

  const handleAmend = async (order: FuturesOrder) => {
    const val = parseFloat(editValue);
    if (!(val > 0)) return;
    setAmending(true);
    try {
      const body: Record<string, unknown> = {
        symbol: order.symbol,
        orderId: order.orderId,
      };
      if (isConditionalOrder(order.type)) {
        body.stopPrice = val;
      } else {
        body.price = val;
      }
      await fetch("/api/bingx/futures/order/amend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* ignore */ }
    setAmending(false);
    setEditing(null);
    fetchData();
  };

  const [closeError, setCloseError] = useState<string | null>(null);

  const handleClose = async (position: FuturesPosition) => {
    setClosing(position.positionId);
    setCloseError(null);
    try {
      const res = await fetch("/api/bingx/futures/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "closePosition", symbol: position.symbol, positionId: position.positionId }),
      });
      const json = await res.json();
      // A failed close must surface to the user — silently swallowing it would look like the position closed.
      if (!json.success) setCloseError(translateError(json, t));
    } catch {
      setCloseError(t("bingx_error.network"));
    } finally {
      setClosing(null);
      fetchData();
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Positions — every open symbol, not just the one on the chart */}
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">Positions ({positions.length})</span>
        </div>
        {closeError && (
          <p className="px-3 py-1.5 text-xs text-danger">{closeError}</p>
        )}
        {positions.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No positions</p>
        ) : (
          <div className="divide-y divide-border-default/50">
            {positions.map((pos) => {
              const pnl = parseFloat(pos.unrealizedProfit);
              const isLong = pos.positionSide === "LONG";
              return (
                <div
                  key={pos.positionId}
                  className={cn("px-3 py-2 hover:bg-bg-hover/50", pos.symbol === symbol && "bg-gold/5")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-text-primary">{pos.symbol}</span>
                      <span className={cn("text-xs font-semibold", isLong ? "text-success" : "text-danger")}>
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                      <span className="text-xs text-text-muted">{pos.isolated ? "isolated" : "cross"} · {pos.leverage}x</span>
                    </div>
                    <button
                      onClick={() => handleClose(pos)}
                      disabled={closing === pos.positionId}
                      className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                    >
                      {closing === pos.positionId ? "..." : "Close"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 text-xs">
                    <span className="text-text-muted">Size</span><span className="text-text-primary text-right">{parseFloat(pos.positionAmt).toFixed(4)}</span>
                    <span className="text-text-muted">Entry</span><span className="text-text-primary text-right">{parseFloat(pos.avgPrice).toFixed(4)}</span>
                    <span className="text-text-muted">Mark</span><span className="text-text-primary text-right">{parseFloat(pos.markPrice).toFixed(4)}</span>
                    <span className="text-text-muted">Liq</span><span className="text-text-primary text-right">{parseFloat(pos.liquidationPrice).toFixed(4)}</span>
                    <span className="text-text-muted">PnL</span>
                    <span className={cn("text-right font-medium", pnl >= 0 ? "text-success" : "text-danger")}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USDT
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Open Orders — every open symbol */}
      <div className="border-t border-border-default">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">Orders ({orders.length})</span>
        </div>
        {orders.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No open orders</p>
        ) : (
          <div className="max-h-40 overflow-auto divide-y divide-border-default/50">
            {orders.map((o) => (
              <div key={o.orderId} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-bg-hover/50">
                <div>
                  <span className="text-text-primary font-medium">{o.symbol}</span>
                  <span className={cn("font-semibold ml-1", o.positionSide === "LONG" ? "text-success" : "text-danger")}>
                    {o.positionSide}
                  </span>
                  <span className="text-text-muted ml-1">{o.type} {o.side}</span>
                </div>
                {editing === o.orderId ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-text-muted text-xs">
                      {isConditionalOrder(o.type) ? "Stop" : "Price"}:
                    </span>
                    <input
                      type="number"
                      step="any"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAmend(o); }}
                      className="w-24 bg-bg-input border border-border-default rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleAmend(o)}
                      disabled={amending || !(parseFloat(editValue) > 0)}
                      className="text-xs text-gold hover:text-gold-light disabled:opacity-40"
                    >
                      {amending ? "…" : "OK"}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="text-text-muted hover:text-text-primary"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-text-muted">
                      {o.type === "LIMIT" ? parseFloat(o.price).toFixed(4) : "MKT"}
                    </span>
                    <span className="text-text-primary">{parseFloat(o.origQty)}</span>
                    {isModifiable(o.type) && (
                      <button
                        onClick={() => startEdit(o)}
                        className="text-text-muted hover:text-gold"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleCancel(o)}
                      disabled={cancelling === o.orderId}
                      className="text-text-muted hover:text-danger disabled:opacity-50"
                    >
                      {cancelling === o.orderId ? "×" : "Cancel"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wallet — futures account margin/equity, always visible at the bottom */}
      <div className="shrink-0 border-t border-border-default px-3 py-2">
        <span className="text-xs font-medium text-text-secondary">合约钱包</span>
        {balance ? (
          <div className="mt-1 grid grid-cols-2 gap-x-2 text-xs">
            <span className="text-text-muted">权益 Equity</span>
            <span className="text-text-primary text-right">{parseFloat(balance.equity).toFixed(2)} USDT</span>
            <span className="text-text-muted">可用保证金</span>
            <span className="text-text-primary text-right">{parseFloat(balance.availableMargin).toFixed(2)} USDT</span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-text-muted">—</p>
        )}
      </div>
    </div>
  );
}
