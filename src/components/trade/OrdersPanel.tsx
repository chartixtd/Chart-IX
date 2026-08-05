"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import {
  useSpotOpenOrders, useSpotMyTrades, useSpotBalances,
  type SpotOpenOrder, type SpotTradeRecord,
} from "@/hooks/useTradingAccount";
import { useUserDataStream } from "@/hooks/useUserDataStream";
import { useAuth } from "@/components/auth/AuthProvider";

interface OrdersPanelProps {
  /** Only used to highlight this symbol's rows; the list itself always shows
   *  every open order/recent fill across all symbols, not just this one. */
  symbol: string;
}

type Tab = "orders" | "fills" | "wallet";

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
  const t = useTranslations("trading");
  const auth = useAuth();
  useUserDataStream({ market: "spot", enabled: !!auth.userId });

  const queryClient = useQueryClient();
  const { data: orders = [], isLoading: ordersLoading, error: ordersError } = useSpotOpenOrders();
  const { data: trades = [], isLoading: tradesLoading } = useSpotMyTrades(30);
  const { data: rawBalances = [], isLoading: balancesLoading } = useSpotBalances();

  const loading = ordersLoading || tradesLoading || balancesLoading;
  const error = ordersError?.message?.includes("No valid API key")
    ? "Please add your BingX API key in Settings first."
    : null;

  const balances = [...rawBalances]
    .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    .sort((a, b) => {
      const ia = PRIORITY_ASSETS.indexOf(a.asset);
      const ib = PRIORITY_ASSETS.indexOf(b.asset);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.asset.localeCompare(b.asset);
    });

  function refetchAll() {
    queryClient.invalidateQueries({ queryKey: ["trading", "spot-open-orders"] });
    queryClient.invalidateQueries({ queryKey: ["trading", "spot-my-trades"] });
    queryClient.invalidateQueries({ queryKey: ["trading", "spot-balances"] });
  }

  const [tab, setTab] = useState<Tab>("orders");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [amending, setAmending] = useState(false);

  const handleCancel = async (order: SpotOpenOrder) => {
    setCancelling(order.orderId);
    try {
      await fetch("/api/bingx/trade/open-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", symbol: order.symbol, orderId: order.orderId }),
      });
    } catch { /* ignore */ }
    setCancelling(null);
    refetchAll();
  };

  // 条件单（止盈止损/触发单）的触发价在 stopPrice 字段；限价单改 price 字段
  // 市价单不会出现在挂单列表（即时成交），所以出现在这里的都能改
  const isConditionalOrder = (type: string) =>
    type.toUpperCase().includes("STOP") ||
    type.toUpperCase().includes("TRIGGER") ||
    type.toUpperCase().includes("TAKE_PROFIT");

  const startEdit = (order: SpotOpenOrder) => {
    // 条件单（止盈止损/触发单）的触发价格在 stopPrice；限价单在 price
    const currentVal = isConditionalOrder(order.type) && order.stopPrice
      ? order.stopPrice
      : order.price;
    setEditValue(currentVal);
    setEditing(order.orderId);
  };

  const handleAmend = async (order: SpotOpenOrder) => {
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
    refetchAll();
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

  const TABS: { key: Tab; label: string }[] = [
    { key: "orders", label: `Open Orders (${orders.length})` },
    { key: "fills", label: "Fills" },
    { key: "wallet", label: `${t("spot_wallet")} (${balances.length})` },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 按合约面板同款的整宽标签页布局——原来三段各自限死 max-h 叠在一起，
          图表挪到下面变宽之后反而显得局促，改成每个标签独占整块空间 */}
      <div className="flex border-b border-border-default shrink-0">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 px-2 py-2 text-xs font-medium transition-colors",
              tab === key ? "text-text-primary border-b-2 border-gold" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
      {tab === "orders" && (
        orders.length === 0 ? (
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
        )
      )}

      {tab === "fills" && (
        trades.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No recent trades</p>
        ) : (
          <div className="divide-y divide-border-default/50">
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
        )
      )}

      {tab === "wallet" && (
        balances.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">—</p>
        ) : (
          <div className="divide-y divide-border-default/50">
            {balances.map((b) => (
              <div key={b.asset} className="px-3 py-2 flex items-center justify-between text-xs">
                <span className="font-medium text-text-primary">{b.asset}</span>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">
                    {t("wallet_available")} <span className="text-text-primary">{formatPriceLocal(b.free)}</span>
                  </span>
                  {parseFloat(b.locked) > 0 && (
                    <span className="text-text-muted">
                      {t("wallet_locked")} <span className="text-text-primary">{formatPriceLocal(b.locked)}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
      </div>
    </div>
  );
}
