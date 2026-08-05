"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePaperAccount, usePaperOrders, useClosePaperPosition } from "@/hooks/usePaperTrading";
import { Spinner } from "@/components/ui/Spinner";
import { formatPrice, formatNumber, cn } from "@/lib/utils";
import { useSpotTicker } from "@/hooks/useMarketData";

interface PaperOrdersPanelProps {
  symbol: string;
}

type Tab = "positions" | "orders" | "fills";

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

function PositionRow({ symbol, side, quantity, entryPrice, leverage, margin, liquidationPrice, onClose, closing, active }: {
  symbol: string; side: "long" | "short"; quantity: number; entryPrice: number;
  leverage: number; margin: number; liquidationPrice: number;
  onClose: (symbol: string) => void; closing: boolean; active: boolean;
}) {
  const t = useTranslations("trading");
  const { data: ticker } = useSpotTicker(symbol);
  const markPrice = ticker ? Number(ticker.lastPrice) : entryPrice;
  // 未实现盈亏按仓位方向计算
  const pnl = side === "long"
    ? (markPrice - entryPrice) * quantity
    : (entryPrice - markPrice) * quantity;
  // 收益率基于占用保证金（含杠杆放大）
  const pnlPct = margin > 0 ? (pnl / margin) * 100 : 0;
  const isProfit = pnl >= 0;
  const isLong = side === "long";

  return (
    <div className={cn("px-3 py-2 border-b border-border-default/50 last:border-0", active && "bg-gold/5")}>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className={cn("rounded-xs px-1 py-0.5 text-[10px] font-bold", isLong ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
            {isLong ? t("long_label") : t("short_label")}
          </span>
          <span className="font-semibold text-text-primary">{symbol}</span>
          <span className="text-gold">{leverage}x</span>
        </div>
        <button
          onClick={() => onClose(symbol)}
          disabled={closing}
          className="rounded-xs bg-danger/10 px-1.5 py-0.5 text-xs text-danger hover:bg-danger/20 disabled:opacity-50"
        >
          {closing ? t("closing") : t("close_position")}
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-text-muted">{formatNumber(quantity, 6)} @ {formatPrice(entryPrice)}</span>
        <span className={cn("font-medium", isProfit ? "text-success" : "text-danger")}>
          {isProfit ? "+" : ""}{formatPrice(pnl)} ({isProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-muted/70">
        <span>{t("liq_price_label")} {formatPrice(liquidationPrice)}</span>
        <span>{t("margin_label")} {formatPrice(margin)} USDT</span>
      </div>
    </div>
  );
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PaperOrdersPanel({ symbol }: PaperOrdersPanelProps) {
  const t = useTranslations("trading");
  const { data, isLoading } = usePaperAccount();
  // No symbol filter: this panel shows every fill across the account, not just
  // whichever symbol the chart happens to be on.
  const { data: orders, isLoading: ordersLoading } = usePaperOrders();
  const closePaperPosition = useClosePaperPosition();

  const [tab, setTab] = useState<Tab>("positions");
  const [limitOrders, setLimitOrders] = useState<PaperLimitOrderRow[]>([]);
  const [limitLoading, setLimitLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [amending, setAmending] = useState(false);

  const positions = data?.positions ?? [];

  const handleClosePosition = async (pSymbol: string) => {
    setClosing(pSymbol);
    try {
      // 精确全平：后端按持仓量平仓，不经过名义值换算，一次清干净
      await closePaperPosition.mutateAsync({ symbol: pSymbol });
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

    // 这个轮询没走 react-query，所以不像别处那样会在标签页失焦时自动停下来。
    // 手动跟着 visibility 开关：后台标签页里挂着的交易页不该每 5 秒打一次服务器，
    // 切回来时立刻补一次，用户看到的仍是最新的挂单。
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval === null) interval = setInterval(fetchLimitOrders, 5_000);
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        fetchLimitOrders();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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

  const startEdit = (order: PaperLimitOrderRow) => {
    setEditValue(String(order.price));
    setEditing(order.id);
  };

  const handleAmend = async (order: PaperLimitOrderRow) => {
    const val = parseFloat(editValue);
    if (!(val > 0)) return;
    setAmending(true);
    try {
      await fetch("/api/paper/limit-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, price: val }),
      });
    } catch { /* ignore */ }
    setAmending(false);
    setEditing(null);
    fetchLimitOrders();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "positions", label: `Positions (${positions.length})` },
    { key: "orders", label: `Orders (${limitOrders.length})` },
    { key: "fills", label: "Fills" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
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

      <div className="flex-1 overflow-auto">
      {tab === "positions" && (
        positions.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">{t("no_open_positions")}</p>
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
              active={p.symbol === symbol}
            />
          ))
        )
      )}

      {tab === "orders" && (
        limitLoading ? (
          <div className="flex items-center justify-center py-4">
            <Spinner className="h-4 w-4" />
          </div>
        ) : limitOrders.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No pending limit orders</p>
        ) : (
          <div className="divide-y divide-border-default/50">
            {limitOrders.map((lo) => (
              <div key={lo.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={cn("font-semibold", lo.side === "buy" ? "text-success" : "text-danger")}>
                    {lo.side === "buy" ? "B" : "S"}
                  </span>
                  <span className="text-text-primary">{lo.symbol}</span>
                  {editing === lo.id ? (
                    <input
                      type="number"
                      step="any"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAmend(lo); }}
                      className="w-20 bg-bg-input border border-border-default rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      autoFocus
                    />
                  ) : (
                    <span className="text-text-muted">{formatPrice(lo.price)}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-text-muted">{formatNumber(lo.quantity, 6)}</span>
                  {editing === lo.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleAmend(lo)}
                        disabled={amending || !(parseFloat(editValue) > 0)}
                        className="text-xs text-gold hover:text-gold-light disabled:opacity-40"
                      >
                        {amending ? "…" : "OK"}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-xs text-text-muted hover:text-text-primary"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(lo)}
                        className="text-xs text-text-muted hover:text-gold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleCancelLimit(lo.id)}
                        disabled={cancelling === lo.id}
                        className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                      >
                        {cancelling === lo.id ? "×" : "Cancel"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "fills" && (
        ordersLoading ? (
          <div className="flex items-center justify-center py-4">
            <Spinner className="h-4 w-4" />
          </div>
        ) : !orders?.length ? (
          <p className="px-3 py-4 text-xs text-text-muted text-center">No recent trades</p>
        ) : (
          <div className="divide-y divide-border-default/50">
            {orders.map((order) => (
              <div key={order.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-primary font-medium">{order.symbol}</span>
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
        )
      )}
      </div>

      {/* Wallet — paper account balance, always visible at the bottom */}
      <div className="shrink-0 border-t border-border-default px-3 py-2.5">
        <div className="text-xs font-medium text-text-secondary">{t("paper_wallet")}</div>
        <div className="mt-0.5 text-lg font-bold text-text-primary">
          {data ? formatPrice(data.account.balance_usdt) : "—"} <span className="text-xs font-normal text-text-muted">USDT</span>
        </div>
      </div>
    </div>
  );
}
