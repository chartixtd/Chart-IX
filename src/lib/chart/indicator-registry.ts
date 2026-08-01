/**
 * Declarative indicator registry — the single source of truth for both the
 * indicator picker UI and the chart's series creation/computation.
 *
 * Adding an indicator means adding one entry here; KlineChart derives its
 * series, panes, params UI, and legend entirely from this table. Every
 * indicator can be applied multiple times with different params (the
 * TradingView convenience: MA(20) + MA(50) + MA(200) side by side).
 */
import {
  computeMA, computeEMA, computeWMA, computeDEMA, computeTEMA, computeVWMA,
  computeVWAP, computeParabolicSAR, computeSuperTrend, computeIchimoku,
  computeBollingerBands, computeKeltnerChannels, computeDonchianChannels,
  computeEnvelope, computeATR, computeStdDev,
  computeRSI, computeMACD, computeStochastic, computeCCI, computeWilliamsR,
  computeMomentum, computeROC, computeTRIX, computeCMO, computeDPO,
  computeUltimateOscillator, computeADX, computeAroon,
  computeOBV, computeMFI, computeCMF,
} from "@/lib/indicators";

export type IndicatorCategory = "trend" | "volatility" | "momentum" | "volume";

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  trend: "趋势",
  volatility: "波动率",
  momentum: "动量 / 震荡",
  volume: "成交量",
};

export interface IndicatorInput {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface PlotDef {
  key: string;
  label?: string;
  color: string;
  kind?: "line" | "histogram" | "dots";
  /** 0 solid, 1 dotted, 2 dashed */
  lineStyle?: 0 | 1 | 2 | 3 | 4;
  lineWidth?: 1 | 2 | 3 | 4;
  /** Histogram plots only: per-bar colour, overriding `color`. */
  barColor?: (ctx: { i: number; value: number; input: IndicatorInput }) => string;
}

export interface IndicatorDef {
  id: string;
  /** Full name shown in the picker. */
  name: string;
  /** Compact name shown in the on-chart legend, e.g. "MA". */
  short: string;
  category: IndicatorCategory;
  /** "main" overlays the price scale; "pane" gets its own stacked pane. */
  placement: "main" | "pane";
  params: ParamDef[];
  plots: PlotDef[];
  compute: (input: IndicatorInput, p: Record<string, number>) => Record<string, (number | null)[]>;
  /** Horizontal reference lines drawn in the indicator's own pane. */
  guides?: number[];
  /** Formats the legend suffix, e.g. "MA 20". Defaults to the joined param values. */
  legendParams?: (p: Record<string, number>) => string;
}

// Distinguishable against the warm-charcoal ground, avoiding the gold reserved for brand accents.
const C = {
  blue: "#60a5fa",
  amber: "#f59e0b",
  purple: "#c084fc",
  cyan: "#22d3ee",
  teal: "#2dd4bf",
  pink: "#f472b6",
  lime: "#a3e635",
  orange: "#fb923c",
  sky: "#38bdf8",
  rose: "#fb7185",
  green: "#34d399",
  indigo: "#818cf8",
  fuchsia: "#e879f9",
  yellow: "#fbbf24",
  up: "#22c55e",
  down: "#ef4444",
  bandBlue: "rgba(96,165,250,0.45)",
  bandGold: "rgba(200,160,80,0.45)",
  bandLime: "rgba(163,230,53,0.45)",
  bandViolet: "rgba(163,113,247,0.45)",
  volUp: "rgba(34, 197, 94, 0.35)",
  volDown: "rgba(239, 68, 68, 0.35)",
};

const p1 = (key: string, label: string, def: number, min = 1, max = 500): ParamDef => ({
  key, label, default: def, min, max, step: 1,
});

export const INDICATORS: IndicatorDef[] = [
  // ---------------- Trend ----------------
  {
    id: "ma", name: "MA 简单移动平均", short: "MA", category: "trend", placement: "main",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "ma", color: C.blue }],
    compute: (i, p) => ({ ma: computeMA(i.close, p.period) }),
  },
  {
    id: "ema", name: "EMA 指数移动平均", short: "EMA", category: "trend", placement: "main",
    params: [p1("period", "周期", 21)],
    plots: [{ key: "ema", color: C.amber }],
    compute: (i, p) => ({ ema: computeEMA(i.close, p.period) }),
  },
  {
    id: "wma", name: "WMA 加权移动平均", short: "WMA", category: "trend", placement: "main",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "wma", color: C.cyan }],
    compute: (i, p) => ({ wma: computeWMA(i.close, p.period) }),
  },
  {
    id: "dema", name: "DEMA 双重指数均线", short: "DEMA", category: "trend", placement: "main",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "dema", color: C.rose }],
    compute: (i, p) => ({ dema: computeDEMA(i.close, p.period) }),
  },
  {
    id: "tema", name: "TEMA 三重指数均线", short: "TEMA", category: "trend", placement: "main",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "tema", color: C.green }],
    compute: (i, p) => ({ tema: computeTEMA(i.close, p.period) }),
  },
  {
    id: "vwma", name: "VWMA 成交量加权均线", short: "VWMA", category: "trend", placement: "main",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "vwma", color: C.teal }],
    compute: (i, p) => ({ vwma: computeVWMA(i.close, i.volume, p.period) }),
  },
  {
    id: "vwap", name: "VWAP 成交量加权均价", short: "VWAP", category: "trend", placement: "main",
    params: [],
    plots: [{ key: "vwap", color: C.yellow }],
    compute: (i) => ({ vwap: computeVWAP(i.high, i.low, i.close, i.volume) }),
    legendParams: () => "",
  },
  {
    id: "sar", name: "抛物线 SAR", short: "SAR", category: "trend", placement: "main",
    params: [
      { key: "step", label: "步长", default: 0.02, min: 0.001, max: 1, step: 0.01 },
      { key: "max", label: "最大值", default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    plots: [{ key: "sar", color: C.fuchsia, kind: "dots" }],
    compute: (i, p) => ({ sar: computeParabolicSAR(i.high, i.low, p.step, p.max) }),
  },
  {
    id: "supertrend", name: "SuperTrend", short: "ST", category: "trend", placement: "main",
    params: [
      p1("period", "ATR 周期", 10),
      { key: "multiplier", label: "倍数", default: 3, min: 0.5, max: 20, step: 0.5 },
    ],
    plots: [{ key: "st", color: C.up, lineWidth: 2 }],
    compute: (i, p) => ({
      st: computeSuperTrend(i.high, i.low, i.close, p.period, p.multiplier).value,
    }),
  },
  {
    id: "ichimoku", name: "一目均衡表", short: "Ichimoku", category: "trend", placement: "main",
    params: [p1("tenkan", "转换线", 9), p1("kijun", "基准线", 26), p1("senkouB", "先行带 B", 52)],
    plots: [
      { key: "tenkan", label: "转换线", color: C.rose },
      { key: "kijun", label: "基准线", color: C.blue },
      { key: "senkouA", label: "先行带 A", color: "rgba(34,197,94,0.45)" },
      { key: "senkouB", label: "先行带 B", color: "rgba(239,68,68,0.45)" },
    ],
    compute: (i, p) => {
      const r = computeIchimoku(i.high, i.low, p.tenkan, p.kijun, p.senkouB);
      return { tenkan: r.tenkan, kijun: r.kijun, senkouA: r.senkouA, senkouB: r.senkouB };
    },
  },
  {
    id: "adx", name: "ADX 平均趋向指标", short: "ADX", category: "trend", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [{ key: "adx", color: C.orange }],
    compute: (i, p) => ({ adx: computeADX(i.high, i.low, i.close, p.period) }),
    guides: [20, 25],
  },
  {
    id: "aroon", name: "Aroon 阿隆指标", short: "Aroon", category: "trend", placement: "pane",
    params: [p1("period", "周期", 25)],
    plots: [
      { key: "up", label: "Up", color: C.up },
      { key: "down", label: "Down", color: C.down },
    ],
    compute: (i, p) => {
      const r = computeAroon(i.high, i.low, p.period);
      return { up: r.up, down: r.down };
    },
    guides: [30, 70],
  },

  // ---------------- Volatility ----------------
  {
    id: "bb", name: "布林带 Bollinger Bands", short: "BB", category: "volatility", placement: "main",
    params: [
      p1("period", "周期", 20),
      { key: "multiplier", label: "标准差倍数", default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    plots: [
      { key: "upper", label: "上轨", color: C.bandGold, lineStyle: 2 },
      { key: "middle", label: "中轨", color: C.bandGold },
      { key: "lower", label: "下轨", color: C.bandGold, lineStyle: 2 },
    ],
    compute: (i, p) => {
      const r = computeBollingerBands(i.close, p.period, p.multiplier);
      return { upper: r.upper, middle: r.middle, lower: r.lower };
    },
  },
  {
    id: "kc", name: "肯特纳通道 Keltner", short: "KC", category: "volatility", placement: "main",
    params: [
      p1("period", "EMA 周期", 20), p1("atrPeriod", "ATR 周期", 10),
      { key: "multiplier", label: "倍数", default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    plots: [
      { key: "upper", label: "上轨", color: C.bandBlue, lineStyle: 2 },
      { key: "lower", label: "下轨", color: C.bandBlue, lineStyle: 2 },
    ],
    compute: (i, p) => {
      const r = computeKeltnerChannels(i.high, i.low, i.close, p.period, p.atrPeriod, p.multiplier);
      return { upper: r.upper, lower: r.lower };
    },
  },
  {
    id: "donchian", name: "唐奇安通道 Donchian", short: "DC", category: "volatility", placement: "main",
    params: [p1("period", "周期", 20)],
    plots: [
      { key: "upper", label: "上轨", color: C.bandLime },
      { key: "lower", label: "下轨", color: C.bandLime },
    ],
    compute: (i, p) => {
      const r = computeDonchianChannels(i.high, i.low, p.period);
      return { upper: r.upper, lower: r.lower };
    },
  },
  {
    id: "envelope", name: "Envelope 百分比通道", short: "ENV", category: "volatility", placement: "main",
    params: [
      p1("period", "周期", 20),
      { key: "percent", label: "百分比", default: 2.5, min: 0.1, max: 50, step: 0.1 },
    ],
    plots: [
      { key: "upper", label: "上轨", color: C.bandViolet, lineStyle: 2 },
      { key: "lower", label: "下轨", color: C.bandViolet, lineStyle: 2 },
    ],
    compute: (i, p) => {
      const r = computeEnvelope(i.close, p.period, p.percent);
      return { upper: r.upper, lower: r.lower };
    },
  },
  {
    id: "atr", name: "ATR 平均真实波幅", short: "ATR", category: "volatility", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [{ key: "atr", color: C.lime }],
    compute: (i, p) => ({ atr: computeATR(i.high, i.low, i.close, p.period) }),
  },
  {
    id: "stddev", name: "标准差 StdDev", short: "StdDev", category: "volatility", placement: "pane",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "sd", color: C.lime }],
    compute: (i, p) => ({ sd: computeStdDev(i.close, p.period) }),
  },

  // ---------------- Momentum ----------------
  {
    id: "rsi", name: "RSI 相对强弱指标", short: "RSI", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [{ key: "rsi", color: C.purple }],
    compute: (i, p) => ({ rsi: computeRSI(i.close, p.period) }),
    guides: [30, 50, 70],
  },
  {
    id: "macd", name: "MACD 指数平滑异同", short: "MACD", category: "momentum", placement: "pane",
    params: [p1("fast", "快线", 12), p1("slow", "慢线", 26), p1("signal", "信号", 9)],
    plots: [
      {
        key: "hist", label: "柱", color: C.up, kind: "histogram",
        barColor: ({ value }) => (value >= 0 ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"),
      },
      { key: "macd", label: "MACD", color: C.blue },
      { key: "signal", label: "信号", color: C.amber },
    ],
    compute: (i, p) => {
      const r = computeMACD(i.close, p.fast, p.slow, p.signal);
      return { macd: r.macd, signal: r.signal, hist: r.histogram };
    },
    guides: [0],
  },
  {
    id: "stoch", name: "随机指标 Stochastic", short: "Stoch", category: "momentum", placement: "pane",
    params: [p1("k", "%K 周期", 14), p1("d", "%D 周期", 3)],
    plots: [
      { key: "k", label: "%K", color: C.blue },
      { key: "d", label: "%D", color: C.amber },
    ],
    compute: (i, p) => {
      const r = computeStochastic(i.high, i.low, i.close, p.k, p.d);
      return { k: r.k, d: r.d };
    },
    guides: [20, 80],
  },
  {
    id: "cci", name: "CCI 顺势指标", short: "CCI", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "cci", color: C.cyan }],
    compute: (i, p) => ({ cci: computeCCI(i.high, i.low, i.close, p.period) }),
    guides: [-100, 0, 100],
  },
  {
    id: "willr", name: "威廉 %R", short: "%R", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [{ key: "r", color: C.pink }],
    compute: (i, p) => ({ r: computeWilliamsR(i.high, i.low, i.close, p.period) }),
    guides: [-80, -20],
  },
  {
    id: "momentum", name: "动量指标 Momentum", short: "MOM", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 10)],
    plots: [{ key: "mom", color: C.indigo }],
    compute: (i, p) => ({ mom: computeMomentum(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "roc", name: "ROC 变动率", short: "ROC", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 12)],
    plots: [{ key: "roc", color: C.pink }],
    compute: (i, p) => ({ roc: computeROC(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "trix", name: "TRIX 三重指数平滑", short: "TRIX", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 15)],
    plots: [{ key: "trix", color: C.blue }],
    compute: (i, p) => ({ trix: computeTRIX(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "cmo", name: "钱德动量摆动指标 CMO", short: "CMO", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [{ key: "cmo", color: C.orange }],
    compute: (i, p) => ({ cmo: computeCMO(i.close, p.period) }),
    guides: [-50, 0, 50],
  },
  {
    id: "dpo", name: "DPO 区间震荡指标", short: "DPO", category: "momentum", placement: "pane",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "dpo", color: C.sky }],
    compute: (i, p) => ({ dpo: computeDPO(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "uo", name: "终极震荡指标 UO", short: "UO", category: "momentum", placement: "pane",
    params: [p1("p1", "周期 1", 7), p1("p2", "周期 2", 14), p1("p3", "周期 3", 28)],
    plots: [{ key: "uo", color: C.purple }],
    compute: (i, p) => ({
      uo: computeUltimateOscillator(i.high, i.low, i.close, p.p1, p.p2, p.p3),
    }),
    guides: [30, 70],
  },

  // ---------------- Volume ----------------
  {
    id: "volume", name: "成交量 Volume", short: "Vol", category: "volume", placement: "pane",
    params: [],
    plots: [
      {
        key: "vol", color: C.volUp, kind: "histogram",
        barColor: ({ i, input }) => (input.close[i] >= input.open[i] ? C.volUp : C.volDown),
      },
    ],
    compute: (i) => ({ vol: i.volume.map((v) => v) }),
    legendParams: () => "",
  },
  {
    id: "obv", name: "OBV 能量潮", short: "OBV", category: "volume", placement: "pane",
    params: [],
    plots: [{ key: "obv", color: C.sky }],
    compute: (i) => ({ obv: computeOBV(i.close, i.volume) }),
    legendParams: () => "",
  },
  {
    id: "mfi", name: "MFI 资金流量指标", short: "MFI", category: "volume", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [{ key: "mfi", color: C.yellow }],
    compute: (i, p) => ({ mfi: computeMFI(i.high, i.low, i.close, i.volume, p.period) }),
    guides: [20, 80],
  },
  {
    id: "cmf", name: "佳庆资金流量 CMF", short: "CMF", category: "volume", placement: "pane",
    params: [p1("period", "周期", 20)],
    plots: [{ key: "cmf", color: C.teal }],
    compute: (i, p) => ({ cmf: computeCMF(i.high, i.low, i.close, i.volume, p.period) }),
    guides: [0],
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

/** Default params for a definition, used when adding a fresh instance. */
export function defaultParams(def: IndicatorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Legend label, e.g. "MA 20" or "MACD 12 26 9". */
export function legendLabel(def: IndicatorDef, params: Record<string, number>): string {
  if (def.legendParams) {
    const suffix = def.legendParams(params);
    return suffix ? `${def.short} ${suffix}` : def.short;
  }
  const vals = def.params.map((p) => params[p.key]).filter((v) => v !== undefined);
  return vals.length ? `${def.short} ${vals.join(" ")}` : def.short;
}

/** A single plot's overridable style fields — mirrors the relevant subset of PlotDef. */
export interface PlotStyleOverride {
  color?: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 0 | 1 | 2 | 3 | 4;
}

/**
 * Resolves a plot's effective color/width/style: the instance's per-plot
 * override when present, falling back to the registry's static default.
 * `overrides` is `AppliedIndicator["styleOverrides"]` — typed loosely here
 * (not imported from chartStore.ts) to avoid a circular import, since
 * chartStore.ts already imports from this module.
 */
export function resolvePlotStyle(
  def: IndicatorDef,
  overrides: Record<string, PlotStyleOverride> | undefined,
  plotKey: string
): { color: string; lineWidth: 1 | 2 | 3 | 4; lineStyle: 0 | 1 | 2 | 3 | 4 } {
  const plot = def.plots.find((p) => p.key === plotKey);
  const override = overrides?.[plotKey];
  return {
    color: override?.color ?? plot?.color ?? "#c9a24b",
    lineWidth: override?.lineWidth ?? plot?.lineWidth ?? 1,
    lineStyle: override?.lineStyle ?? plot?.lineStyle ?? 0,
  };
}
