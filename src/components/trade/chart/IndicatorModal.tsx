"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import {
  INDICATORS, CATEGORY_LABELS, CATEGORY_LABELS_ZH, legendLabel, resolvePlotStyle, settingVisible,
  type IndicatorCategory, type IndicatorDef,
} from "@/lib/chart/indicator-registry";
import { SettingControl } from "./SettingControl";
import { CandleStyleControls } from "./CandleStyleControls";
import { useChartStore, resolveDef } from "@/stores/chartStore";
import { cn } from "@/lib/utils";
import { ColorPicker } from "./ColorPicker";
import { LineStyleControl, type DrawingLineStyle } from "./LineStyleControl";
import { Icon } from "@/components/ui/Icon";

const CATEGORIES: (IndicatorCategory | "all")[] = ["all", "trend", "momentum", "volatility", "volume", "derivatives"];

const LINE_STYLE_TO_DRAWING: Record<number, DrawingLineStyle> = { 0: "solid", 1: "dotted", 2: "dashed", 3: "dashed", 4: "dotted" };
const DRAWING_TO_LINE_STYLE: Record<DrawingLineStyle, 0 | 1 | 2> = { solid: 0, dotted: 1, dashed: 2 };

export function IndicatorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("trade.indicators");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const isZh = locale === "zh-CN" || locale === "zh";
  const categoryLabels = isZh ? CATEGORY_LABELS_ZH : CATEGORY_LABELS;
  const CATEGORY_TAB_LABELS: Record<IndicatorCategory | "all", string> = {
    all: tCommon("all"),
    ...categoryLabels,
  };
  const indicatorName = (def: IndicatorDef) => (isZh ? def.nameZh : def.name);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IndicatorCategory | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  // 设置面板的「输入 / 样式」两页，对齐 TradingView 的指标设置对话框
  const [editTab, setEditTab] = useState<"inputs" | "style">("inputs");

  const applied = useChartStore((s) => s.appliedIndicators);
  const addIndicator = useChartStore((s) => s.addIndicator);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const updateIndicatorParams = useChartStore((s) => s.updateIndicatorParams);
  const updateIndicatorSettings = useChartStore((s) => s.updateIndicatorSettings);
  const updateIndicatorStyle = useChartStore((s) => s.updateIndicatorStyle);
  const toggleIndicatorVisible = useChartStore((s) => s.toggleIndicatorVisible);
  const resetIndicatorToDefaults = useChartStore((s) => s.resetIndicatorToDefaults);
  const clearIndicators = useChartStore((s) => s.clearIndicators);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return INDICATORS.filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.nameZh.toLowerCase().includes(q) ||
        d.short.toLowerCase().includes(q) ||
        d.id.includes(q)
      );
    });
  }, [query, category]);

  const appliedCountByDef = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of applied) m.set(a.defId, (m.get(a.defId) ?? 0) + 1);
    return m;
  }, [applied]);

  return (
    <Modal open={open} onClose={onClose} title={t("title")} className="max-w-3xl" surface="panel">
      <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
        {/* ---- Browse / search ---- */}
        <div className="flex min-h-0 flex-col">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search_placeholder")}
            className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-xs px-2 py-1 text-xs font-medium transition-colors",
                  category === c
                    ? "bg-gold/20 text-gold"
                    : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
                )}
              >
                {CATEGORY_TAB_LABELS[c]}
              </button>
            ))}
          </div>

          <div className="mt-3 max-h-[46vh] min-h-[200px] overflow-y-auto rounded-sm border border-border-default">
            {results.length === 0 ? (
              <p className="p-4 text-center text-xs text-text-muted">{t("no_results")}</p>
            ) : (
              results.map((def) => {
                const count = appliedCountByDef.get(def.id) ?? 0;
                return (
                  <button
                    key={def.id}
                    onClick={() => addIndicator(def.id)}
                    className="flex w-full items-center justify-between gap-2 border-b border-border-default px-3 py-2 text-left last:border-b-0 hover:bg-bg-tertiary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-text-primary">{indicatorName(def)}</span>
                      <span className="block text-[11px] text-text-muted">
                        {categoryLabels[def.category]}
                        {def.placement === "pane" ? ` · ${t("placement_pane")}` : ` · ${t("placement_main")}`}
                        {def.requires?.length ? ` · ${t("ext_interval_note")}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {count > 0 && (
                        <span className="rounded-full bg-gold/15 px-1.5 py-0.5 font-mono text-[11px] lg:text-[10px] text-gold">
                          ×{count}
                        </span>
                      )}
                      <span className="text-gold">＋</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {t("duplicate_hint")}
          </p>
        </div>

        {/* ---- Applied ---- */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">
              {t("applied")} <span className="font-mono text-xs text-text-muted">({applied.length})</span>
            </p>
            {applied.length > 0 && (
              <button
                onClick={clearIndicators}
                className="text-[11px] text-text-muted hover:text-danger"
              >
                {t("remove_all")}
              </button>
            )}
          </div>

          <div className="mt-3 max-h-[52vh] min-h-[200px] overflow-y-auto rounded-sm border border-border-default">
            {applied.length === 0 ? (
              <p className="p-4 text-center text-xs text-text-muted">
                {t("empty_hint")}
              </p>
            ) : (
              applied.map((a) => {
                const def = resolveDef(a);
                if (!def) return null;
                const isEditing = editingId === a.instanceId;
                return (
                  <div key={a.instanceId} className="border-b border-border-default last:border-b-0">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: def.plots[0]?.color }}
                        />
                        <span
                          className={cn(
                            "truncate font-mono text-xs",
                            a.visible ? "text-text-primary" : "text-text-muted line-through"
                          )}
                        >
                          {legendLabel(def, a.params, a.settings)}
                        </span>
                      </span>

                      <button
                        onClick={() => toggleIndicatorVisible(a.instanceId)}
                        title={a.visible ? t("hide") : t("show")}
                        aria-label={a.visible ? t("hide") : t("show")}
                        className="shrink-0 text-text-muted hover:text-text-primary"
                      >
                        <Icon name={a.visible ? "eye" : "eye-off"} className="h-3.5 w-3.5" />
                      </button>
                      {(def.params.length > 0 || def.settings?.length || def.plots.length > 0) && (
                        <button
                          onClick={() => setEditingId(isEditing ? null : a.instanceId)}
                          title={t("settings")}
                          aria-label={t("settings")}
                          className={cn(
                            "shrink-0 hover:text-text-primary",
                            isEditing ? "text-gold" : "text-text-muted"
                          )}
                        >
                          <Icon name="settings" className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => removeIndicator(a.instanceId)}
                        title={t("remove")}
                        aria-label={t("remove")}
                        className="shrink-0 text-text-muted hover:text-danger"
                      >
                        <Icon name="x" className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                    </div>

                    {isEditing && (
                      <div className="space-y-2 bg-bg-tertiary/60 px-3 pb-3 pt-1">
                        <div className="flex gap-1 border-b border-border-default pb-1">
                          {(["inputs", "style"] as const).map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setEditTab(tab)}
                              className={cn(
                                "rounded-xs px-2 py-0.5 text-[11px] font-medium transition-colors",
                                editTab === tab ? "bg-gold/20 text-gold" : "text-text-muted hover:text-text-primary"
                              )}
                            >
                              {t(tab === "inputs" ? "tab_inputs" : "tab_style")}
                            </button>
                          ))}
                        </div>

                        {editTab === "inputs" && def.params.length === 0 && !def.settings?.length && (
                          <p className="text-[11px] text-text-muted">{t("no_inputs")}</p>
                        )}

                        {editTab === "inputs" && def.params.map((pd) => (
                          <label key={pd.key} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-text-secondary">{pd.label}</span>
                            <input
                              type="number"
                              value={a.params[pd.key] ?? pd.default}
                              min={pd.min}
                              max={pd.max}
                              step={pd.step ?? 1}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (Number.isNaN(v)) return;
                                const clamped = Math.min(
                                  pd.max ?? Number.POSITIVE_INFINITY,
                                  Math.max(pd.min ?? Number.NEGATIVE_INFINITY, v)
                                );
                                updateIndicatorParams(a.instanceId, { [pd.key]: clamped });
                              }}
                              className="w-20 rounded-xs border border-border-default bg-bg-primary px-2 py-1 text-right font-mono text-[11px] text-text-primary focus:border-gold focus:outline-none"
                            />
                          </label>
                        ))}

                        {editTab === "inputs" &&
                          (def.settings ?? [])
                            .filter((sd) => settingVisible(sd, a.settings, def.settings))
                            .map((sd) => (
                              <SettingControl
                                key={sd.key}
                                def={sd}
                                settings={a.settings}
                                isZh={isZh}
                                onChange={(patch) => updateIndicatorSettings(a.instanceId, patch)}
                              />
                            ))}

                        {editTab === "inputs" && def.requires?.length ? (
                          <p className="text-[11px] lg:text-[10px] leading-snug text-text-muted">{t("ext_settings_note")}</p>
                        ) : null}

                        {editTab === "style" && def.plots.filter((p) => p.kind === "candles").map((plot) => (
                          <CandleStyleControls
                            key={plot.key}
                            def={def}
                            plotKey={plot.key}
                            overrides={a.styleOverrides}
                            display={a.settings?.display === "line" ? "line" : "candles"}
                            onChange={(patch) => updateIndicatorStyle(a.instanceId, plot.key, patch)}
                          />
                        ))}

                        {editTab === "style" && def.plots.filter((p) => p.kind !== "candles").map((plot) => {
                          const resolved = resolvePlotStyle(def, a.styleOverrides, plot.key);
                          return (
                            <div key={plot.key} className="space-y-1">
                              <span className="text-[11px] text-text-secondary">{plot.label ?? plot.key}</span>
                              <ColorPicker
                                value={resolved.color}
                                onChange={(color) => updateIndicatorStyle(a.instanceId, plot.key, { color })}
                              />
                              {plot.kind !== "histogram" && plot.kind !== "dots" && (
                                <LineStyleControl
                                  width={resolved.lineWidth}
                                  style={LINE_STYLE_TO_DRAWING[resolved.lineStyle]}
                                  onWidthChange={(lineWidth) => updateIndicatorStyle(a.instanceId, plot.key, { lineWidth })}
                                  onStyleChange={(s) => updateIndicatorStyle(a.instanceId, plot.key, { lineStyle: DRAWING_TO_LINE_STYLE[s] })}
                                />
                              )}
                            </div>
                          );
                        })}
                        <button
                          onClick={() => resetIndicatorToDefaults(a.instanceId)}
                          className="text-[11px] text-text-muted hover:text-gold"
                        >
                          {t("restore_defaults")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
