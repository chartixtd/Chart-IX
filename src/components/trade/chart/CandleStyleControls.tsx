"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  resolveCandleStyle, resolvePlotStyle, type IndicatorDef, type PlotStyleOverride,
} from "@/lib/chart/indicator-registry";
import { LineStyleControl, type DrawingLineStyle } from "./LineStyleControl";
import { cn } from "@/lib/utils";

const LINE_STYLE_TO_DRAWING: Record<number, DrawingLineStyle> = { 0: "solid", 1: "dotted", 2: "dashed", 3: "dashed", 4: "dotted" };
const DRAWING_TO_LINE_STYLE: Record<DrawingLineStyle, 0 | 1 | 2> = { solid: 0, dotted: 1, dashed: 2 };
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface Props {
  def: IndicatorDef;
  plotKey: string;
  overrides: Record<string, PlotStyleOverride> | undefined;
  /** 当前是蜡烛还是折线显示（由「输入」页的 display 设置决定） */
  display: "candles" | "line";
  onChange: (patch: PlotStyleOverride) => void;
}

/**
 * 蜡烛类 plot 的「样式」页：对齐 TradingView 蜡烛指标的样式选项——
 * 涨/跌各自的实体、边框、影线颜色，价格轴标签，价格线，精度；
 * 折线显示时换成折线颜色/粗细/线型。
 */
export function CandleStyleControls({ def, plotKey, overrides, display, onChange }: Props) {
  const t = useTranslations("trade.indicators");
  const cs = resolveCandleStyle(overrides, plotKey);
  const line = resolvePlotStyle(def, overrides, plotKey);

  return (
    <div className="space-y-2">
      {display === "candles" ? (
        <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1.5 text-[11px]">
          <span />
          <span className="text-text-muted">{t("style_up")}</span>
          <span className="text-text-muted">{t("style_down")}</span>

          <span className="text-text-secondary">{t("style_body")}</span>
          <ColorSwatch value={cs.upColor} onChange={(upColor) => onChange({ upColor })} />
          <ColorSwatch value={cs.downColor} onChange={(downColor) => onChange({ downColor })} />

          <span className="text-text-secondary">{t("style_border")}</span>
          <ColorSwatch value={cs.borderUpColor} onChange={(borderUpColor) => onChange({ borderUpColor })} />
          <ColorSwatch value={cs.borderDownColor} onChange={(borderDownColor) => onChange({ borderDownColor })} />

          <span className="text-text-secondary">{t("style_wick")}</span>
          <ColorSwatch value={cs.wickUpColor} onChange={(wickUpColor) => onChange({ wickUpColor })} />
          <ColorSwatch value={cs.wickDownColor} onChange={(wickDownColor) => onChange({ wickDownColor })} />
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-text-secondary">{t("style_line_color")}</span>
            <ColorSwatch value={line.color} onChange={(color) => onChange({ color })} />
          </div>
          <LineStyleControl
            width={line.lineWidth}
            style={LINE_STYLE_TO_DRAWING[line.lineStyle]}
            onWidthChange={(lineWidth) => onChange({ lineWidth })}
            onStyleChange={(s) => onChange({ lineStyle: DRAWING_TO_LINE_STYLE[s] })}
          />
        </div>
      )}

      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-text-secondary">{t("style_axis_label")}</span>
        <input
          type="checkbox"
          checked={cs.lastValueVisible}
          onChange={(e) => onChange({ lastValueVisible: e.target.checked })}
          className="h-3 w-3 accent-gold"
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-text-secondary">{t("style_price_line")}</span>
        <input
          type="checkbox"
          checked={cs.priceLineVisible}
          onChange={(e) => onChange({ priceLineVisible: e.target.checked })}
          className="h-3 w-3 accent-gold"
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-text-secondary">{t("style_precision")}</span>
        <select
          value={cs.precision}
          onChange={(e) => onChange({ precision: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 })}
          className="w-24 rounded-xs border border-border-default bg-bg-primary px-2 py-1 font-mono text-[11px] text-text-primary focus:border-gold focus:outline-none"
        >
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>{n === 2 ? t("style_precision_default") : n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** 紧凑版取色：原生色块 + hex 文本，一行放得下两个。 */
function ColorSwatch({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const isHex = HEX_RE.test(value);
  return (
    <span className="flex items-center gap-1">
      <input
        type="color"
        value={isHex ? value : "#888888"}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value); }}
        className="h-5 w-6 cursor-pointer rounded-xs border border-border-default bg-transparent p-0"
        aria-label={value}
      />
      <input
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); if (HEX_RE.test(e.target.value)) onChange(e.target.value); }}
        className={cn(
          "w-[4.5rem] rounded-xs border border-border-default bg-bg-primary px-1.5 py-0.5 font-mono text-[11px] text-text-primary focus:border-gold focus:outline-none",
          !HEX_RE.test(text) && "border-danger/60"
        )}
      />
    </span>
  );
}
