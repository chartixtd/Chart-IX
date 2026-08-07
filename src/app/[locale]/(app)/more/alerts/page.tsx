"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { formatPrice } from "@/lib/utils";

export default function AlertsPage() {
  const t = useTranslations("nav");
  const alerts = usePriceAlertsStore((s) => s.alerts);
  const fetchAlerts = usePriceAlertsStore((s) => s.fetchAlerts);
  const removeAlert = usePriceAlertsStore((s) => s.removeAlert);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-2xl tracking-tighter text-text-primary">
        {t("more_alerts")}
      </h1>

      <ul className="mt-6 divide-y divide-border-default border-y border-border-default">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex items-center justify-between gap-3 py-3.5">
            <div>
              <p className="text-sm text-text-primary">{alert.symbol}</p>
              <p className="mt-0.5 font-mono text-xs text-text-muted">
                {alert.direction === "above" ? "≥" : "≤"} {formatPrice(alert.targetPrice)}
                {alert.triggered && <span className="ml-2 text-gold">✓</span>}
              </p>
            </div>
            <button
              onClick={() => void removeAlert(alert.id)}
              className="flex h-11 w-11 items-center justify-center text-text-muted active:text-danger"
              aria-label="Delete"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
