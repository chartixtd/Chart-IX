"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface OrdersPanelProps {
  symbol: string;
}

interface BingXOrder {
  symbol: string;
  orderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
  time: number;
  updateTime: number;
}

interface BingXTradeRecord {
  symbol: string;
  id: string;
  orderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

interface BingXBalanceItem {
  asset: string;
  free: string;
  locked: string;
}

const PRIORITY_ASSETS = ["USDT", "BTC", "ETH"];

const STATUS_COLORS: Record<string, string> = {
  NEW: "text-blue-400",
  PARTIALLY_FILLED: "text-gold",
  FILLED: "text-success",
  CANCELED: "text-text-muted",
  REJECTED: "text-danger",
  EXPIRED: "text-text-muted",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function OrdersPanel({ symbol }: OrdersPanelProps) {
  const [orders, setOrders] = useState<BingXOrder[]>([]);
  const [trades, setTrades] = useState<BingXTradeRecord[]>([]);
  const [balances, setBalances] = useState<BingXBalanceItem[]>([]);
  const [balancesOpen, setBalancesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, tradesRes, balanceRes] = await Promise.all([
        fetch(`/api/bingx/trade/open-orders?symbol=${symbol}`),
        fetch(`/api/bingx/trade/my-trades?symbol=${symbol}&limit=20`),
        fetch(`/api/bingx/account/balance`),
      ]);

      const ordersJson = await ordersRes.json();
      const tradesJson = await tradesRes.json();
      const balanceJson = await balanceRes.json();

      if (ordersJson.success) {
        setOrders(ordersJson.data.orders || []);
      } else if (ordersJson.error?.message?.includes("No valid API key")) {
        setError("Please add your BingX API key in Settings first.");
      }

      if (tradesJson.success) {
        setTrades(tradesJson.data.fills || []);
      }

      if (balanceJson.success && balanceJson.data?.balances) {
        const filtered = (balanceJson.data.balances as BingXBalanceItem[]).filter(
          (b) => parseFloat(b.free) > 0
        );
        filtered.sort((a, b) => {
          const ia = PRIORITY_ASSETS.indexOf(a.asset);
          const ib = PRIORITY_ASSETS.indexOf(b.asset);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.asset.localeCompare(b.asset);
        });
        setBalances(filtered);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Fetch on mount and every 5 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try {
      await fetch("/api/bingx/trade/open-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", symbol, orderId }),
      });
    } catch { /* ignore */ }
    setCancelling(null);
    fetchData();
  };

  const handleCancelAll = async () => {
    if (!orders.length) return;
    setCancellingAll(true);
    try {
      await fetch("/api/bingx/trade/open-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancelAll", symbol }),
      });
    } catch { /* ignore */ }
    setCancellingAll(false);
    fetchData();
  };

  const formatQtyLocal = (v: string) => {
    const n = parseFloat(v);
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.001) return n.toFixed(4);
    return n.toFixed(8);
  };

  const formatPriceLocal = (v: string) => {
    const n = parseFloat(v);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(n < 0.01 ? 8 : 4);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <p className="text-xs text-text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Balances */}
      {balances.length > 0 && (
        <div className="border-b border-border-default">
          <button
            onClick={() => setBalancesOpen(!balancesOpen)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-hover/50 text-xs"
          >
            <span className="font-medium text-text-secondary">
              Balances ({balances.length})
            </span>
            <span className="text-text-muted">{balancesOpen ? "▲" : "▼"}</span>
          </button>
          {balancesOpen && (
            <div className="divide-y divide-border-default/50 max-h-40 overflow-auto">
              {balances.map((b) => (
                <div key={b.asset} className="px-3 py-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-text-primary">{b.asset}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-text-muted">
                      Free: <span className="text-text-primary">{formatPriceLocal(b.free)}</span>
                    </span>
                    {parseFloat(b.locked) > 0 && (
                      <span className="text-text-muted">
                        Locked: <span className="text-text-primary">{formatPriceLocal(b.locked)}</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Orders */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">
            Open Orders ({orders.length})
          </span>
          {orders.length > 0 && (
            <button
              onClick={handleCancelAll}
              disabled={cancellingAll}
              className="text-xs text-danger hover:text-danger/80 disabled:opacity-50"
            >
              {cancellingAll ? "Cancelling..." : "Cancel All"}
            </button>
          )}
        </div>

        {orders.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No open orders</p>
        ) : (
          <div className="divide-y divide-border-default/50">
            {orders.map((order) => (
              <div key={order.orderId} className="px-3 py-2 hover:bg-bg-hover/50">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        order.side === "BUY" ? "text-success" : "text-danger"
                      )}
                    >
                      {order.side}
                    </span>
                    <span className="text-xs text-text-muted">{order.type}</span>
                  </div>
                  <button
                    onClick={() => handleCancel(order.orderId)}
                    disabled={cancelling === order.orderId}
                    className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                  >
                    {cancelling === order.orderId ? "×" : "Cancel"}
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">
                    {order.type === "LIMIT" && `${formatPriceLocal(order.price)} · `}
                    {formatQtyLocal(order.executedQty)}/{formatQtyLocal(order.origQty)}
                  </span>
                  <span className={STATUS_COLORS[order.status] || "text-text-muted"}>
                    {order.status.replace("_", " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Trades */}
      <div className="border-t border-border-default">
        <div className="px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">Recent Fills</span>
        </div>
        {trades.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No recent trades</p>
        ) : (
          <div className="max-h-40 overflow-auto divide-y divide-border-default/50">
            {trades.map((trade) => (
              <div key={trade.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "font-semibold",
                      trade.isBuyer ? "text-success" : "text-danger"
                    )}
                  >
                    {trade.isBuyer ? "B" : "S"}
                  </span>
                  <span className="text-text-primary">{formatQtyLocal(trade.qty)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">{formatPriceLocal(trade.price)}</span>
                  <span className="text-text-muted w-12 text-right">{formatTime(trade.time)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
