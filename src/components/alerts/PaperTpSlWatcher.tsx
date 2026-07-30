"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMarketStore } from "@/stores/market";
import { usePaperAccount, useClosePaperPosition } from "@/hooks/usePaperTrading";
import { useToast } from "@/components/ui/Toast";
import { checkTpSlHit } from "@/lib/trading/tp-sl";

/**
 * Headless watcher — mirrors PriceAlertWatcher's pattern (subscribe to the
 * ticker store directly so a price tick doesn't re-render this component).
 * Paper positions have no real exchange to enforce their stop orders, so this
 * is the paper-trading equivalent of "the exchange filled your TP/SL order":
 * once the live price crosses a stored take-profit/stop-loss, it closes the
 * position via the same endpoint the manual "平仓" button uses.
 *
 * Only fires for symbols with a live ticker already flowing through
 * useMarketStore (i.e. currently favorited or on-screen) — same reach
 * limitation the price-alert watcher has.
 */
export function PaperTpSlWatcher() {
  const userId = useAuth().userId;
  const { data } = usePaperAccount(!!userId);
  const closePosition = useClosePaperPosition();
  const { toast } = useToast();

  const dataRef = useRef(data);
  dataRef.current = data;
  const closeRef = useRef(closePosition);
  closeRef.current = closePosition;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // Guards against firing a second close while the first request is in flight —
  // ticks can arrive faster than the round trip to /api/paper/close.
  const closingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const unsubscribe = useMarketStore.subscribe((state) => {
      const positions = dataRef.current?.positions ?? [];
      for (const pos of positions) {
        if (closingRef.current.has(pos.symbol)) continue;
        const ticker = state.tickers[pos.symbol];
        if (!ticker) continue;
        const price = Number(ticker.lastPrice);
        const hit = checkTpSlHit(pos.side, price, pos.take_profit_price, pos.stop_loss_price);
        if (!hit) continue;

        closingRef.current.add(pos.symbol);
        closeRef.current.mutate(
          { symbol: pos.symbol },
          {
            onSuccess: () => {
              toastRef.current(
                `${pos.symbol} 触发${hit === "tp" ? "止盈" : "止损"}，模拟盘已自动平仓`,
                hit === "tp" ? "success" : "info"
              );
            },
            onError: (e) => {
              toastRef.current(`${pos.symbol} 自动平仓失败：${String(e)}`, "error");
            },
            onSettled: () => {
              closingRef.current.delete(pos.symbol);
            },
          }
        );
      }
    });

    return unsubscribe;
  }, [userId]);

  return null;
}
