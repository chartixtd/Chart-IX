"use client";

import { useEffect, useState, useCallback } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

interface OrdersPanelProps {
  /** Only used to highlight this symbol's rows; the list itself always shows
   *  every open order/recent fill across all symbols, not just this one. */
  symbol: string;
}

interface BingXOrder {
  symbol: string;
  orderId: string;
  price: string;
  stopPrice?: string;
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
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [amending, setAmending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // No symbol filter: this panel is the account-wide "everything I have
      // open" view, not scoped to whichever symbol the chart happens to be on.
      const [ordersRes, tradesRes, balanceRes] = await Promise.all([
        fetch(`/api/bingx/trade/open-orders`),
        fetch(`/api/bingx/trade/my-trades?limit=30`),
        fetch(`/api/bingx/account/balance`),
      ]);

      const ordersJson = await ordersRes.json();
      const tradesJson = await tradesRes.json();
      const balanceJson = await balanceRes.json();

      if (ordersJson.success) {
        setOrders(Array.isArray(ordersJson.data) ? ordersJson.data : ordersJson.data?.orders || []);
      } else if (ordersJson.error?.message?.includes("No valid API key")) {
        setError("Please add your BingX API key in Settings first.");
      }

      if (tradesJson.success) {
        setTrades(Array.isArray(tradesJson.data) ? tradesJson.data : tradesJson.data?.fills || []);
      }

      if (balanceJson.success && balanceJson.data?.balances) {
        const filtered = (balanceJson.data.balances as BingXBalanceItem[]).filter(
          (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
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
  }, []);

  // Fetch on mount and every 5 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCancel = async (order: BingXOrder) => {
    setCancelling(order.orderId);
    try {
      await fetch("/api/bingx/trade/open-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", symbol: order.symbol, orderId: order.orderId }),
      });
    } catch { /* ignore */ }
    setCancelling(null);
    fetchData();
  };

  // 条件单（止盈止损/触发单）的触发价在 stopPrice 字段；限价单改 price 字段
  // 市价单不会出现在挂单列表（即时成交），所以出现在这里的都能改
  const isConditionalOrder = (type: string) =>
    type.toUpperCase().includes("STOP") ||
    type.toUpperCase().includes("TRIGGER") ||
    type.toUpperCase().includes("TAKE_PROFIT");

  const startEdit = (order: BingXOrder) => {
    // 条件单（止盈止损/触发单）的触发价格在 stopPrice；限价单在 price
    const currentVal = isConditionalOrder(order.type) && order.stopPrice
      ? order.stopPrice
      : order.price;
    setEditValue(currentVal);
    setEditing(order.orderId);
  };

  const handleAmend = async (order: BingXOrder) => {
    const val = parseFloat(editValue);
    if (!(val > 0)) return;
    setAmending(true);
    try {
      const body: Record<string, unknown> = {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.origQty,
        cancelOrderId: order.orderId,
      };
      if (isConditionalOrder(order.type)) {
        body.stopPrice = val;
      } else {
        body.price = val;
      }
      await fetch("/api/bingx/trade/order/amend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { /* ignore */ }
    setAmending(false);
    setEditing(null);
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
      {/* Active Orders — every open symbol, not just the one on the chart */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
          <span className="text-xs font-medium text-text-secondary">
            Open Orders ({orders.length})
          </span>
        </div>

        {orders.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No open orders</p>
        ) : (
          <div className="divide-y divide-border-default/50">
            {orders.map((order) => (
              <div
                key={order.orderId}
                className={cn("px-3 py-2 hover:bg-bg-hover/50", order.symbol === symbol && "bg-gold/5")}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-text-primary">{order.symbol}</span>
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
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => editing === order.orderId ? setEditing(null) : startEdit(order)}
                      className="text-xs text-text-muted hover:text-gold"
                    >
                      {editing === order.orderId ? "×" : "Edit"}
                    </button>
                    <button
                      onClick={() => handleCancel(order)}
                      disabled={cancelling === order.orderId}
                      className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                    >
                      {cancelling === order.orderId ? "×" : "Cancel"}
                    </button>
                  </div>
                </div>

                {editing === order.orderId ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-text-muted shrink-0">
                      {isConditionalOrder(order.type) ? "Stop" : "Price"}:
                    </span>
                    <input
                      type="number"
                      step="any"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAmend(order); }}
                      className="flex-1 bg-bg-input border border-border-default rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleAmend(order)}
                      disabled={amending || !(parseFloat(editValue) > 0)}
                      className="text-xs text-gold hover:text-gold-light disabled:opacity-40 shrink-0"
                    >
                      {amending ? "…" : "OK"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">
                      {order.type === "LIMIT" && `${formatPriceLocal(order.price)} · `}
                      {formatQtyLocal(order.executedQty)}/{formatQtyLocal(order.origQty)}
                    </span>
                    <span className={STATUS_COLORS[order.status] || "text-text-muted"}>
                      {order.status.replace("_", " ")}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Trades — every symbol */}
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
                  <span className="text-text-primary font-medium">{trade.symbol}</span>
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

      {/* Wallet — spot balances, always visible at the bottom */}
      <div className="shrink-0 border-t border-border-default px-3 py-2">
        <span className="text-xs font-medium text-text-secondary">现货钱包 ({balances.length})</span>
        {balances.length === 0 ? (
          <p className="mt-1 text-xs text-text-muted">—</p>
        ) : (
          <div className="mt-1 max-h-32 overflow-auto divide-y divide-border-default/50">
            {balances.map((b) => (
              <div key={b.asset} className="py-1 flex items-center justify-between text-xs">
                <span className="font-medium text-text-primary">{b.asset}</span>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">
                    可用 <span className="text-text-primary">{formatPriceLocal(b.free)}</span>
                  </span>
                  {parseFloat(b.locked) > 0 && (
                    <span className="text-text-muted">
                      冻结 <span className="text-text-primary">{formatPriceLocal(b.locked)}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
