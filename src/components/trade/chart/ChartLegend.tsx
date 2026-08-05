"use client";

import { useTranslations } from "next-intl";
import { legendLabel } from "@/lib/chart/indicator-registry";
import { useChartStore, resolveDef } from "@/stores/chartStore";
import { cn } from "@/lib/utils";

/**
 * On-chart legend listing every applied indicator, each with inline
 * hide / settings / remove controls — the TradingView pattern where you manage
 * indicators from the chart itself rather than reopening a dialog.
 */
export function ChartLegend({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useTranslations("trade.indicators");
  const applied = useChartStore((s) => s.appliedIndicators);
  const toggleVisible = useChartStore((s) => s.toggleIndicatorVisible);
  const removeIndicator = useChartStore((s) => s.removeIndicator);

  if (applied.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-2 top-10 z-[6] flex max-w-[60%] flex-col items-start gap-0.5">
      {applied.map((a) => {
        const def = resolveDef(a);
        if (!def) return null;
        return (
          <div
            key={a.instanceId}
            className="pointer-events-auto group flex items-center gap-2 rounded-xs bg-bg-primary/55 px-2 py-1 backdrop-blur-sm"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: def.plots[0]?.color, opacity: a.visible ? 1 : 0.3 }}
            />
            <span
              className={cn(
                "font-mono text-xs leading-none",
                a.visible ? "text-text-secondary" : "text-text-muted line-through"
              )}
            >
              {legendLabel(def, a.params)}
            </span>

            <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => toggleVisible(a.instanceId)}
                title={a.visible ? t("hide") : t("show")}
                className="text-xs leading-none text-text-muted hover:text-text-primary"
              >
                {a.visible ? "👁" : "🚫"}
              </button>
              <button
                onClick={onOpenSettings}
                title={t("settings")}
                className="text-xs leading-none text-text-muted hover:text-gold"
              >
                ⚙
              </button>
              <button
                onClick={() => removeIndicator(a.instanceId)}
                title={t("remove")}
                className="text-xs leading-none text-text-muted hover:text-danger"
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
