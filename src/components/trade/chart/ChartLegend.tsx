"use client";

import { useTranslations } from "next-intl";
import { legendLabel } from "@/lib/chart/indicator-registry";
import type { ExternalSeriesStatus } from "@/hooks/useExternalSeries";
import { useChartStore, resolveDef } from "@/stores/chartStore";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";

/**
 * On-chart legend listing every applied indicator, each with inline
 * hide / settings / remove controls — the TradingView pattern where you manage
 * indicators from the chart itself rather than reopening a dialog.
 */
export function ChartLegend({
  onOpenSettings,
  externalStatus,
  externalErrors,
}: {
  onOpenSettings: () => void;
  /** CoinGlass 序列的加载状态，按实例 id。声明了 `requires` 的指标据此显示提示。 */
  externalStatus?: Record<string, ExternalSeriesStatus | "invalid">;
  /** 出错时的上游错误码，按实例 id。跟在「数据暂不可用」后面显示，便于自诊断。 */
  externalErrors?: Record<string, string>;
}) {
  const t = useTranslations("trade.indicators");
  const applied = useChartStore((s) => s.appliedIndicators);
  const toggleVisible = useChartStore((s) => s.toggleIndicatorVisible);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const collapsed = useChartStore((s) => s.legendCollapsed);
  const toggleCollapsed = useChartStore((s) => s.toggleLegendCollapsed);

  if (applied.length === 0) return null;

  // 折叠态：整组图例塌成一行——只留下各指标的颜色点和数量，
  // 让出左上角那块 K 线。展开态里折叠按钮占第一行行首的固定槽位，
  // 其余行留同宽的空槽，颜色点才不会错位。
  if (collapsed) {
    return (
      <div className="pointer-events-none absolute left-2 top-10 z-[6] flex max-w-[60%] flex-col items-start gap-0.5">
        <button
          onClick={toggleCollapsed}
          title={t("legend_expand")}
          aria-label={t("legend_expand")}
          aria-expanded={false}
          className="pointer-events-auto flex items-center gap-1.5 rounded-xs bg-bg-primary/85 px-2 py-1.5 text-text-muted hover:text-text-primary"
        >
          <Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0" />
          <span className="flex items-center gap-1">
            {applied.map((a) => {
              const def = resolveDef(a);
              if (!def) return null;
              return (
                <span
                  key={a.instanceId}
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: def.plots[0]?.color, opacity: a.visible ? 1 : 0.3 }}
                />
              );
            })}
          </span>
          <span className="font-mono text-xs leading-none">{applied.length}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute left-2 top-10 z-[6] flex max-w-[60%] flex-col items-start gap-0.5">
      {applied.map((a, i) => {
        const def = resolveDef(a);
        if (!def) return null;
        // 外部数据指标：把「周期不支持 / 加载中 / 不可用」直接写在图例上，
        // 否则空副图看起来像坏了。
        const extState = def.requires?.length ? externalStatus?.[a.instanceId] : undefined;
        const extHint =
          extState === "unsupported"
            ? t("ext_unsupported_interval")
            : extState === "loading"
              ? t("ext_loading")
              : extState === "error"
                ? `${t("ext_error")}${externalErrors?.[a.instanceId] ? ` (${externalErrors[a.instanceId]})` : ""}`
                : extState === "invalid"
                  ? t("ext_invalid_symbol")
                  : null;
        return (
          <div
            key={a.instanceId}
            className="pointer-events-auto group flex items-center gap-2 rounded-xs bg-bg-primary/85 px-2.5 py-1.5"
          >
            {i === 0 ? (
              <button
                onClick={toggleCollapsed}
                title={t("legend_collapse")}
                aria-label={t("legend_collapse")}
                aria-expanded
                className="-ml-1 shrink-0 leading-none text-text-muted hover:text-text-primary"
              >
                <Icon name="chevronUp" className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span aria-hidden className="-ml-1 h-3.5 w-3.5 shrink-0" />
            )}
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: def.plots[0]?.color, opacity: a.visible ? 1 : 0.3 }}
            />
            <span
              className={cn(
                "font-mono text-sm leading-none",
                a.visible ? "text-text-secondary" : "text-text-muted line-through"
              )}
            >
              {legendLabel(def, a.params, a.settings)}
            </span>
            {def.source === "coinglass" && (
              <span className="rounded-xs bg-gold/10 px-1 font-mono text-[10px] leading-none text-gold/80">
                CoinGlass
              </span>
            )}
            {extHint && (
              <span className={cn("text-[11px] leading-none", extState === "error" || extState === "invalid" ? "text-danger" : "text-text-muted")}>
                {extHint}
              </span>
            )}

            <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => toggleVisible(a.instanceId)}
                title={a.visible ? t("hide") : t("show")}
                aria-label={a.visible ? t("hide") : t("show")}
                className="leading-none text-text-muted hover:text-text-primary"
              >
                <Icon name={a.visible ? "eye" : "eye-off"} className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onOpenSettings}
                title={t("settings")}
                aria-label={t("settings")}
                className="leading-none text-text-muted hover:text-gold"
              >
                <Icon name="settings" className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => removeIndicator(a.instanceId)}
                title={t("remove")}
                aria-label={t("remove")}
                className="leading-none text-text-muted hover:text-danger"
              >
                <Icon name="x" className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
