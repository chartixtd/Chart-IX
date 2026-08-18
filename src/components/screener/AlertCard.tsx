"use client";

import { useTranslations } from "next-intl";
import { cn, formatPrice } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { FactorStack } from "./FactorStack";

const FACTOR_LABELS = [
  ["zone", "Zone"],
  ["sweep", "Sweep"],
  ["oi", "OI"],
  ["cvd", "CVD"],
] as const;

// 接收 t 而不是硬编码文案——页面其余文案全部走 i18n，这里也不能例外
// （英文/马来语环境下直接冒出一个中文"刚刚"是真的会发生的 bug）。
// t 本身已经在组件里按 render 存在，这里只是把它当参数传进来，
// 不会额外产生开销大的对象。
function sinceLabel(iso: string, t: ReturnType<typeof useTranslations>): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("alerts.just_now");
  if (mins < 60) return t("alerts.minutes_ago", { n: mins });
  return t("alerts.hours_ago", { n: Math.round(mins / 60) });
}

export function AlertCard({ alert }: { alert: AlertRecord }) {
  const t = useTranslations("screener");
  const pct = alert.currentPct ?? 0;

  return (
    <div className="rounded-lg panel p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              alert.direction === "long" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
            )}
          >
            {alert.direction === "long" ? "LONG" : "SHORT"}
          </span>
          <span className="font-display text-sm font-semibold text-text-primary">
            {alert.symbol.replace(/-USDT$/, "")}
          </span>
        </div>
        <span className="text-[11px] text-text-muted">
          {sinceLabel(alert.triggeredAt, t)} {t("alerts.triggered")}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
        {t("alerts.trigger_line", {
          score: alert.triggerScore,
          zone: alert.factors.zone,
          sweep: alert.factors.sweep,
          oi: alert.factors.oi,
          cvd: alert.factors.cvd,
        })}
      </p>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.first_price")}
          </div>
          <div className="tnum text-sm text-text-secondary">{formatPrice(alert.triggerPrice)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.last_price")}
          </div>
          <div className="tnum text-sm text-text-primary">
            {alert.lastPrice === null ? "—" : formatPrice(alert.lastPrice)}
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-md bg-bg-tertiary px-3 py-2 text-center">
        <div className={cn("tnum text-xl font-bold", pct >= 0 ? "text-success" : "text-danger")}>
          {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          {t("alerts.cumulative")}
          {alert.peakPct !== null && (
            <span className="ml-1.5">
              · {t("alerts.peak")} {alert.peakPct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        {FACTOR_LABELS.map(([key, label]) => (
          <div key={key} className="flex flex-col items-center gap-1">
            <FactorStack factors={alert.factors} size="lg" only={key} />
            <span className="text-[10px] text-text-muted">{label}</span>
            <span className="tnum text-[10px] text-text-secondary">
              {alert.factors[key]}/{FACTOR_MAX[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
