"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { translateError } from "@/components/trade/order-form/OrderForm";

interface FuturesInfoPanelProps {
  symbol: string;
}

interface FuturesPosition {
  symbol: string;
  positionId: string;
  positionSide: "LONG" | "SHORT";
  positionAmt: string;
  unrealizedProfit: string;
  leverage: number;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  marginType: string;
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

export function FuturesInfoPanel({ symbol }: FuturesInfoPanelProps) {
  const t = useTranslations();
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [orders, setOrders] = useState<FuturesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [posRes, ordRes] = await Promise.all([
        fetch(`/api/bingx/futures/positions?symbol=${symbol}`),
        fetch(`/api/bingx/futures/open-orders?symbol=${symbol}`),
      ]);
      const p = await posRes.json();
      const o = await ordRes.json();
      if (p.success) setPositions(p.data || []);
      if (o.success) setOrders(Array.isArray(o.data) ? o.data : o.data?.orders || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    await fetch("/api/bingx/futures/open-orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", symbol, orderId }),
    });
    setCancelling(null);
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
        body: JSON.stringify({ action: "closePosition", symbol, positionId: position.positionId }),
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
      {/* Positions */}
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
                <div key={pos.positionId} className="px-3 py-2 hover:bg-bg-hover/50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-xs font-semibold", isLong ? "text-success" : "text-danger")}>
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                      <span className="text-xs text-text-muted">{pos.marginType} · {pos.leverage}x</span>
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
                    <span className="text-text-muted">Entry</span><span className="text-text-primary text-right">{parseFloat(pos.entryPrice).toFixed(4)}</span>
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

      {/* Open Orders */}
      <div className="border-t border-border-default">
        <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
          <span className="text-xs font-medium text-text-secondary">Orders ({orders.length})</span>
          {orders.length > 0 && (
            <button
              onClick={async () => {
                await fetch("/api/bingx/futures/open-orders", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "cancelAll", symbol }),
                });
                fetchData();
              }}
              className="text-xs text-danger hover:text-danger/80"
            >
              Cancel All
            </button>
          )}
        </div>
        {orders.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No open orders</p>
        ) : (
          <div className="max-h-40 overflow-auto divide-y divide-border-default/50">
            {orders.map((o) => (
              <div key={o.orderId} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-bg-hover/50">
                <div>
                  <span className={cn("font-semibold", o.positionSide === "LONG" ? "text-success" : "text-danger")}>
                    {o.positionSide}
                  </span>
                  <span className="text-text-muted ml-1">{o.type} {o.side}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">
                    {o.type === "LIMIT" ? parseFloat(o.price).toFixed(4) : "MKT"}
                  </span>
                  <span className="text-text-primary">{parseFloat(o.origQty)}</span>
                  <button
                    onClick={() => handleCancel(o.orderId)}
                    disabled={cancelling === o.orderId}
                    className="text-text-muted hover:text-danger disabled:opacity-50"
                  >
                    {cancelling === o.orderId ? "×" : "Cancel"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
