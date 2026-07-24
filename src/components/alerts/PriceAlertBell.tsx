"use client";

import { useState } from "react";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { formatPrice, cn } from "@/lib/utils";

export function PriceAlertBell() {
  const alerts = usePriceAlertsStore((s) => s.alerts);
  const removeAlert = usePriceAlertsStore((s) => s.removeAlert);
  const [open, setOpen] = useState(false);

  if (alerts.length === 0) return null;

  const triggeredCount = alerts.filter((a) => a.triggered).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
        aria-label="Price alerts"
      >
        🔔
        {triggeredCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
            {triggeredCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-72 rounded-md border border-border-default bg-bg-secondary shadow-modal">
            <div className="border-b border-border-default px-3 py-2 text-xs font-medium text-text-secondary">
              价格提醒
            </div>
            <div className="max-h-80 overflow-y-auto">
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-xs",
                    a.triggered ? "bg-gold/5" : ""
                  )}
                >
                  <span className={a.triggered ? "text-gold" : "text-text-secondary"}>
                    {a.symbol} {a.direction === "above" ? "≥" : "≤"} {formatPrice(a.targetPrice)}
                    {a.triggered && " · 已触发"}
                  </span>
                  <button
                    onClick={() => removeAlert(a.id)}
                    className="text-text-muted hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
