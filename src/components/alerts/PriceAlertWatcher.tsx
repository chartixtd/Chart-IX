"use client";

import { useEffect, useRef } from "react";
import { useMarketStore } from "@/stores/market";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { useToast } from "@/components/ui/Toast";
import { formatPrice } from "@/lib/utils";

/**
 * Headless watcher — subscribes to the ticker store directly (not via a React
 * selector) so a price tick doesn't re-render this component; it just checks
 * pending alerts and fires a toast + marks them triggered when crossed.
 */
export function PriceAlertWatcher() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const unsubscribe = useMarketStore.subscribe((state) => {
      const { alerts, markTriggered } = usePriceAlertsStore.getState();
      const pending = alerts.filter((a) => !a.triggered);
      if (pending.length === 0) return;

      for (const alert of pending) {
        const ticker = state.tickers[alert.symbol];
        if (!ticker) continue;
        const price = Number(ticker.lastPrice);
        if (!Number.isFinite(price)) continue;

        const hit =
          alert.direction === "above" ? price >= alert.targetPrice : price <= alert.targetPrice;

        if (hit) {
          markTriggered(alert.id);
          toastRef.current(
            `${alert.symbol} ${alert.direction === "above" ? "涨到" : "跌到"} ${formatPrice(price)}，达到你设置的提醒价 ${formatPrice(alert.targetPrice)}`,
            "info"
          );
        }
      }
    });
    return unsubscribe;
  }, []);

  return null;
}
