"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import { cn, formatBySpec } from "@/lib/utils";
import { translateError } from "@/components/trade/order-form/OrderForm";
import {
  useFuturesPositions, useFuturesOpenOrders, useFuturesContracts,
  type FuturesPosition, type FuturesOpenOrder,
} from "@/hooks/useTradingAccount";
import { useUserDataStream } from "@/hooks/useUserDataStream";
import { useAuth } from "@/components/auth/AuthProvider";
import { FuturesPositionRow } from "./FuturesPositionRow";
import { FuturesOrderHistoryTab } from "./FuturesOrderHistoryTab";
import { FuturesFillHistoryTab } from "./FuturesFillHistoryTab";

interface FuturesInfoPanelProps {
  /** Only used to highlight this symbol's position row; the list itself always
   *  shows every open futures position/order, not just this symbol. */
  symbol: string;
}

type Tab = "positions" | "orders" | "history" | "fills";

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function FuturesInfoPanel({ symbol }: FuturesInfoPanelProps) {
  const t = useTranslations();
  const auth = useAuth();

  useUserDataStream({ market: "futures", enabled: !!auth.userId });

  const queryClient = useQueryClient();
  const { data: positions = [], isLoading: positionsLoading } = useFuturesPositions();
  const { data: orders = [], isLoading: ordersLoading } = useFuturesOpenOrders();
  const { data: contracts } = useFuturesContracts();
  const loading = positionsLoading || ordersLoading;

  const [tab, setTab] = useState<Tab>("positions");

  // useCallback so the row-action handlers below (which depend on this) can
  // themselves be stable across renders — otherwise every FuturesInfoPanel
  // re-render (driven by the positions/orders polling) would hand each
  // FuturesPositionRow a fresh callback identity, defeating that row's memo().
  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["trading", "futures-positions"] });
    queryClient.invalidateQueries({ queryKey: ["trading", "futures-open-orders"] });
    queryClient.invalidateQueries({ queryKey: ["trading", "futures-balance"] });
  }, [queryClient]);

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [amending, setAmending] = useState(false);

  // 面板级的最近一次操作错误。row 组件里的 actionError 只在该持仓仍存在、行还挂载时可见——
  // 但反向开仓失败这类情况会导致该持仓从列表中消失（第一腿平仓已成功），行随之卸载，
  // 局部错误状态跟着丢失。这里独立保存一份，保证错误信息在行消失后依然能显示给用户。
  const [lastActionError, setLastActionError] = useState<string | null>(null);

  const handleCancel = async (order: FuturesOpenOrder) => {
    setCancelling(order.orderId);
    await fetch("/api/bingx/futures/open-orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", symbol: order.symbol, orderId: order.orderId }),
    });
    setCancelling(null);
    refetchAll();
  };

  // 条件单（止盈止损/触发单）的触发价在 stopPrice 字段；限价单改 price 字段
  // 市价单不会出现在挂单列表（即时成交），所以出现在这里的都能改
  const isConditionalOrder = (type: string) =>
    type.toUpperCase().includes("STOP") ||
    type.toUpperCase().includes("TAKE_PROFIT");

  const startEdit = (order: FuturesOpenOrder) => {
    const currentVal = isConditionalOrder(order.type) && order.stopPrice
      ? order.stopPrice
      : order.price;
    setEditValue(currentVal);
    setEditing(order.orderId);
  };

  const handleAmend = async (order: FuturesOpenOrder) => {
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
    refetchAll();
  };

  const handleClose = useCallback(async (position: FuturesPosition) => {
    setLastActionError(null);
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "closePosition", symbol: position.symbol, positionId: position.positionId,
      });
      if (!json.success) {
        const message = translateError(json, t);
        setLastActionError(message);
        return { ok: false, message };
      }
      return { ok: true };
    } catch {
      const message = t("bingx_error.network");
      setLastActionError(message);
      return { ok: false, message };
    } finally {
      refetchAll();
    }
  }, [t, refetchAll]);

  const handleReduceOnlyClose = useCallback(async (position: FuturesPosition, percent: number) => {
    setLastActionError(null);
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "reduceOnlyClose", symbol: position.symbol, positionId: position.positionId,
        positionSide: position.positionSide, percent,
      });
      if (!json.success) {
        const message = translateError(json, t);
        setLastActionError(message);
        return { ok: false, message };
      }
      return { ok: true };
    } catch {
      const message = t("bingx_error.network");
      setLastActionError(message);
      return { ok: false, message };
    } finally {
      refetchAll();
    }
  }, [t, refetchAll]);

  const handleReverse = useCallback(async (position: FuturesPosition) => {
    setLastActionError(null);
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "reversePosition", symbol: position.symbol, positionId: position.positionId,
        positionSide: position.positionSide,
      });
      if (!json.success) {
        // 这条错误最关键：反向开仓的第一腿（平仓）可能已经成功，触发这个失败的持仓
        // 会从列表中消失，行组件随之卸载——所以必须落在面板级状态里才能让用户看到
        const message = translateError(json, t);
        setLastActionError(message);
        return { ok: false, message };
      }
      return { ok: true };
    } catch {
      const message = t("bingx_error.network");
      setLastActionError(message);
      return { ok: false, message };
    } finally {
      refetchAll();
    }
  }, [t, refetchAll]);

  const handleSaveTpSl = useCallback(async (position: FuturesPosition, tp: string, sl: string, cancelTp?: boolean, cancelSl?: boolean) => {
    setLastActionError(null);
    try {
      const json = await postJson("/api/bingx/futures/positions", {
        action: "setPositionTpSl", symbol: position.symbol, positionSide: position.positionSide,
        takeProfitPrice: tp || undefined, stopLossPrice: sl || undefined,
        cancelTakeProfit: cancelTp || undefined, cancelStopLoss: cancelSl || undefined,
      });
      if (!json.success) {
        const message = translateError(json, t);
        setLastActionError(message);
        return { ok: false, message };
      }
      refetchAll();
      return { ok: true };
    } catch {
      const message = t("bingx_error.network");
      setLastActionError(message);
      return { ok: false, message };
    }
  }, [t, refetchAll]);

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Spinner className="h-5 w-5" /></div>;
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "positions", label: `Positions (${positions.length})` },
    { key: "orders", label: `Orders (${orders.length})` },
    { key: "history", label: "History" },
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

      {lastActionError && (
        <p className="shrink-0 border-b border-border-default px-3 py-1.5 text-xs text-danger">
          {lastActionError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" && (
          positions.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted text-center">No positions</p>
          ) : (
            <div className="divide-y divide-border-default/50">
              {positions.map((pos) => {
                // 持仓行本身不带止盈止损值——BingX 的持仓接口不返回这个，
                // 只能从挂单列表里反查同 symbol/positionSide 的条件单
                const currentTp = orders.find(
                  (o) => o.symbol === pos.symbol && o.positionSide === pos.positionSide && o.type.toUpperCase().includes("TAKE_PROFIT")
                )?.stopPrice;
                const currentSl = orders.find(
                  (o) => o.symbol === pos.symbol && o.positionSide === pos.positionSide && o.type.toUpperCase().includes("STOP")
                )?.stopPrice;
                return (
                <FuturesPositionRow
                  key={pos.positionId}
                  position={pos}
                  highlighted={pos.symbol === symbol}
                  currentTp={currentTp}
                  currentSl={currentSl}
                  onClose={handleClose}
                  onReduceOnlyClose={handleReduceOnlyClose}
                  onReverse={handleReverse}
                  onSaveTpSl={handleSaveTpSl}
                />
                );
              })}
            </div>
          )
        )}

        {tab === "orders" && (
          orders.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted text-center">No open orders</p>
          ) : (
            <div className="divide-y divide-border-default/50">
              {orders.map((o) => {
                const spec = contracts?.get(o.symbol);
                return (
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
                        className="w-24 bg-bg-tertiary border border-border-default rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                        aria-label="Cancel"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted">
                        {isConditionalOrder(o.type) && o.stopPrice
                          ? `${t("trading.triggered")} ${formatBySpec(parseFloat(o.stopPrice), spec?.pricePrecision)}`
                          : o.type === "LIMIT"
                            ? formatBySpec(parseFloat(o.price), spec?.pricePrecision)
                            : "MKT"}
                      </span>
                      <span className="text-text-primary">{formatBySpec(parseFloat(o.origQty), spec?.quantityPrecision)}</span>
                      <button
                        onClick={() => startEdit(o)}
                        className="text-text-muted hover:text-gold"
                      >
                        Edit
                      </button>
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
                );
              })}
            </div>
          )
        )}

        {tab === "history" && <FuturesOrderHistoryTab />}
        {tab === "fills" && <FuturesFillHistoryTab />}
      </div>
    </div>
  );
}
