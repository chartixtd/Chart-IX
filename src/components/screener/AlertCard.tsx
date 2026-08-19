"use client";

import { useTranslations } from "next-intl";
import { cn, formatPrice, formatPercent } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { FactorStack } from "./FactorStack";
import { scenarioTone, readingKey, TONE_CLASSES, DIRECTION_CLASSES } from "./scenario-ui";

const FACTOR_LABELS = [
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

/** direction/scenario.direction 三态 pill 的文案，manage 统一显示成"观望"。 */
function directionLabel(dir: "long" | "short" | "manage", t: ReturnType<typeof useTranslations>): string {
  if (dir === "long") return "LONG";
  if (dir === "short") return "SHORT";
  return t("scenarios.pill_manage");
}

export function AlertCard({ alert }: { alert: AlertRecord }) {
  const t = useTranslations("screener");
  const pct = alert.currentPct ?? 0;

  // 老警报（T22 之前触发、没有场景判定）：沿用简单卡片样式，不套用
  // 场景基调——scenario 为 null 时也没有判定句/操作文案/CVD-OI 标签
  // 这些场景专属信息可拼。
  if (!alert.scenario) {
    return (
      <div className="rounded-lg panel p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
                alert.direction === "long"
                  ? "bg-success/15 text-success"
                  : alert.direction === "short"
                    ? "bg-danger/15 text-danger"
                    : "bg-text-secondary/15 text-text-secondary"
              )}
            >
              {directionLabel(alert.direction, t)}
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

  // 有场景判定：按模板重做的六场景卡片。tone 管左边框/场景名/分值条颜色，
  // scenario.direction 管顶部 pill 与操作指令条颜色——两套配色分开是故意的，
  // 见 scenario-ui.ts DIRECTION_CLASSES 顶部注释。
  const { scenario } = alert;
  const tone = scenarioTone(scenario.kind);
  const toneCls = TONE_CLASSES[tone];
  const dirCls = DIRECTION_CLASSES[scenario.direction];
  const pricePct = ((scenario.swingNow - scenario.swingPrev) / scenario.swingPrev) * 100;
  const verdict = t(`scenarios.reading.${readingKey(scenario.kind, scenario.side)}`, {
    price: formatPrice(scenario.swingNow),
    pricePct: formatPercent(pricePct),
    cvdPct: formatPercent(scenario.cvdPct),
    oiPct: formatPercent(scenario.oiPct),
  });

  return (
    <div className={cn("rounded-lg panel border-l-2 p-3.5", toneCls.border)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              dirCls.pillBg,
              dirCls.pillText
            )}
          >
            {directionLabel(scenario.direction, t)}
          </span>
          <span className="font-display text-sm font-semibold text-text-primary">
            {alert.symbol.replace(/-USDT$/, "")}
          </span>
        </div>
        <span className="text-[11px] text-text-muted">
          {sinceLabel(alert.triggeredAt, t)} {t("alerts.triggered")}
        </span>
      </div>

      <div className="mb-2.5 flex items-center gap-1.5">
        <span className={cn("font-display text-[13px] font-bold", toneCls.text)}>
          {t(`scenarios.${scenario.kind}.name`)}
        </span>
        {scenario.trap && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-purple-400">
            <span aria-hidden>⚠</span>
            {t("scenarios.trap_label")}
          </span>
        )}
      </div>

      <p className="mb-3 rounded-md bg-bg-tertiary px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary">
        {verdict}
      </p>

      <div
        className={cn(
          "mb-3 rounded-md px-2.5 py-2 text-xs font-semibold",
          dirCls.actionBg,
          dirCls.actionText
        )}
      >
        {t(`scenarios.${scenario.kind}.action`)}
      </div>

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
            <FactorStack factors={alert.factors} size="lg" only={key} fillClassName={toneCls.fill} />
            <span className="text-[10px] text-text-muted">{label}</span>
            <span className={cn("text-[10px] font-medium", toneCls.text)}>
              {t(`scenarios.${key}_tag.${scenario.kind}`)}
            </span>
            <span className="tnum text-[10px] text-text-secondary">
              {alert.factors[key]}/{FACTOR_MAX[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
