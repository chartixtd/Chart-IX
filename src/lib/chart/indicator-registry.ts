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
  computeMA, computeEMA, computeWMA, computeHullMA, computeDEMA, computeTEMA, computeVWMA,
  computeVWAP, computeParabolicSAR, computeSuperTrend, computeIchimoku,
  computeBollingerBands, computeKeltnerChannels, computeDonchianChannels,
  computeEnvelope, computeATR, computeStdDev,
  computeRSI, computeMACD, computeStochastic, computeKDJ, computeStochRSI, computeCCI, computeWilliamsR,
  computeMomentum, computeROC, computeTRIX, computeCMO, computeDPO,
  computeUltimateOscillator, computeADX, computeAroon, computeVortex,
  computeOBV, computeMFI, computeCMF, computeAwesomeOscillator, computeAlligator, computePivotPoints, computeChaikinOscillator,
} from "@/lib/indicators";
import {
  coinFromChartSymbol,
  emptyCandles,
  FUTURES_EXCHANGE_CHOICES,
  SPOT_EXCHANGE_CHOICES,
  type CandleSeries,
  type ExternalInput,
  type ExternalKind,
  type ExternalSettingValue,
} from "@/lib/chart/external-series";
import { CHART } from "@/lib/chart-theme";

export type IndicatorCategory = "trend" | "volatility" | "momentum" | "volume" | "derivatives";

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  trend: "Trend",
  volatility: "Volatility",
  momentum: "Momentum / Oscillators",
  volume: "Volume",
  derivatives: "Derivatives · CoinGlass",
};

export const CATEGORY_LABELS_ZH: Record<IndicatorCategory, string> = {
  trend: "趋势",
  volatility: "波动率",
  momentum: "动量 / 震荡",
  volume: "成交量",
  derivatives: "衍生品数据 · CoinGlass",
};

export interface IndicatorInput {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  /**
   * 来自 CoinGlass、已对齐到同一根 K 线数组的外部序列（见 external-series.ts）。
   * 只有声明了 `requires` 的指标会读它；KlineChart 只在有指标声明了才去拉，
   * 没拉到/周期不支持时为 undefined，指标应当退化成全 null 而不是抛错。
   */
  ext?: ExternalInput;
}

/**
 * compute() 每条 plot 的输出：普通指标是数值数组；`kind: "candles"` 的 plot
 * 输出与 K 线等长的蜡烛数组。两者都用 null 表示"这一根没有值"。
 */
export type PlotSeries = (number | null)[] | CandleSeries;

export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

/** 一个选项：value 存进 settings，label/labelZh 给控件显示。 */
export interface SettingOption {
  value: string;
  label: string;
  labelZh: string;
}

/**
 * 非数值的指标设置（TradingView「输入」页里下拉/文本/多选那一类）。
 * 与 `params`（数值、进 compute）分开存：这些值不参与指标计算，而是决定
 * **去哪里拿数据、怎么画**，由 KlineChart 与取数 hook 消费。
 *
 * `showWhen` 让一项只在另一项取某些值时出现（自定义品种的文本框只在
 * 「品种来源 = 自定义」时显示）。
 */
export type SettingDef = {
  key: string;
  label: string;
  labelZh: string;
  showWhen?: { key: string; in: string[] };
} & (
  | { type: "select"; options: SettingOption[]; default: string }
  | { type: "text"; default: string; placeholder?: string }
  | {
      type: "multiselect";
      /** 勾选清单；可按另一项的取值切换（现货/合约的交易所清单不同） */
      options: SettingOption[] | ((settings: Record<string, ExternalSettingValue>) => SettingOption[]);
      default: string[];
      /** 允许在清单之外手填（逗号分隔），满足清单没覆盖到的交易所 */
      allowCustom?: boolean;
    }
);

export interface PlotDef {
  key: string;
  label?: string;
  color: string;
  /** "candles" 的 plot 必须由 compute() 输出 CandleSeries；颜色固定用图表主题的涨跌色。 */
  kind?: "line" | "histogram" | "dots" | "candles";
  /** 0 solid, 1 dotted, 2 dashed */
  lineStyle?: 0 | 1 | 2 | 3 | 4;
  lineWidth?: 1 | 2 | 3 | 4;
  /** Histogram plots only: per-bar colour, overriding `color`. */
  barColor?: (ctx: { i: number; value: number; input: IndicatorInput }) => string;
}

export interface IndicatorDef {
  id: string;
  /** Full name shown in the picker (English). */
  name: string;
  /** Full name shown in the picker for the Chinese locale. */
  nameZh: string;
  /** Compact name shown in the on-chart legend, e.g. "MA". */
  short: string;
  category: IndicatorCategory;
  /** "main" overlays the price scale; "pane" gets its own stacked pane. */
  placement: "main" | "pane";
  params: ParamDef[];
  plots: PlotDef[];
  compute: (input: IndicatorInput, p: Record<string, number>) => Record<string, PlotSeries>;
  /** Horizontal reference lines drawn in the indicator's own pane. */
  guides?: number[];
  /**
   * 需要 KlineChart 额外拉取的外部序列。声明了就意味着：只在 30m 及以上周期
   * 有数据、数据经 /api/coinglass/series 来、Pro 专属。
   */
  requires?: ExternalKind[];
  /** 数据来源标签，图例与选择器上显示。 */
  source?: "coinglass";
  /** 非数值设置项（见 SettingDef）。 */
  settings?: SettingDef[];
  /** 图例里设置值的摘要，对齐 TradingView 在状态行显示输入值的做法。 */
  legendSettings?: (s: Record<string, ExternalSettingValue>) => string;
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

// ---- CoinGlass 指标共用的设置项 ----
// 键的含义见 external-series.ts 的 ExternalSettings 注释；buildExternalRequest
// 按这些键把设置变成请求。

const toOptions = (names: readonly string[]): SettingOption[] =>
  names.map((n) => ({ value: n, label: n, labelZh: n }));

const CG_SYMBOL_MODE: SettingDef = {
  key: "symbolMode", label: "Symbol", labelZh: "品种来源", type: "select", default: "main",
  options: [
    { value: "main", label: "Main chart symbol", labelZh: "跟随主图品种" },
    { value: "custom", label: "Custom", labelZh: "自定义" },
  ],
};
const CG_SYMBOL: SettingDef = {
  key: "symbol", label: "Custom symbol", labelZh: "自定义品种", type: "text", default: "", placeholder: "ETH / ETH-USDT",
  showWhen: { key: "symbolMode", in: ["custom"] },
};
const CG_UNIT: SettingDef = {
  key: "unit", label: "Unit", labelZh: "单位", type: "select", default: "usd",
  options: [
    { value: "usd", label: "Dollars", labelZh: "美元" },
    { value: "coin", label: "Coins", labelZh: "币" },
  ],
};
const CG_EXCHANGE_MODE: SettingDef = {
  key: "exchangeMode", label: "Exchange filter", labelZh: "交易所筛选", type: "select", default: "all",
  options: [
    { value: "all", label: "No Filter (aggregated default)", labelZh: "No Filter（默认聚合组合）" },
    { value: "custom", label: "Custom selection", labelZh: "自选" },
  ],
};
const CG_EXCHANGES: SettingDef = {
  key: "exchanges", label: "Exchanges", labelZh: "交易所", type: "multiselect", default: [],
  options: [], allowCustom: true,
  showWhen: { key: "exchangeMode", in: ["custom"] },
};
const CG_DISPLAY: SettingDef = {
  key: "display", label: "Display", labelZh: "显示方式", type: "select", default: "candles",
  options: [
    { value: "candles", label: "Candles", labelZh: "蜡烛" },
    { value: "line", label: "Line", labelZh: "折线" },
  ],
};
const CG_LINE_SOURCE: SettingDef = {
  key: "lineSource", label: "Line value", labelZh: "折线取值", type: "select", default: "open",
  options: [
    { value: "open", label: "open", labelZh: "open" },
    { value: "high", label: "high", labelZh: "high" },
    { value: "low", label: "low", labelZh: "low" },
    { value: "close", label: "close", labelZh: "close" },
  ],
  showWhen: { key: "display", in: ["line"] },
};

/** 图例摘要：自定义品种 · 市场/保证金 · 单位 · 交易所。对齐 TradingView 状态行里显示输入值的习惯。 */
function cgLegend(
  s: Record<string, ExternalSettingValue>,
  modeLabels: Record<string, string>,
  modeKey: string
): string {
  const parts: string[] = [];
  if (s.symbolMode === "custom" && typeof s.symbol === "string" && s.symbol) parts.push(coinFromChartSymbol(s.symbol));
  const mode = typeof s[modeKey] === "string" ? modeLabels[s[modeKey] as string] : undefined;
  if (mode) parts.push(mode);
  parts.push(s.unit === "coin" ? "币" : "USD");
  if (s.exchangeMode === "custom" && Array.isArray(s.exchanges) && s.exchanges.length) {
    parts.push(s.exchanges.length <= 2 ? s.exchanges.join("+") : `${s.exchanges[0]}+${s.exchanges.length - 1}`);
  } else {
    parts.push("No Filter");
  }
  return parts.join(" · ");
}

export const INDICATORS: IndicatorDef[] = [
  // ---------------- Trend ----------------
  {
    id: "ma", name: "MA (Simple Moving Average)", nameZh: "MA 简单移动平均", short: "MA", category: "trend", placement: "main",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "ma", color: C.blue }],
    compute: (i, p) => ({ ma: computeMA(i.close, p.period) }),
  },
  {
    id: "ema", name: "EMA (Exponential Moving Average)", nameZh: "EMA 指数移动平均", short: "EMA", category: "trend", placement: "main",
    params: [p1("period", "Period", 21)],
    plots: [{ key: "ema", color: C.amber }],
    compute: (i, p) => ({ ema: computeEMA(i.close, p.period) }),
  },
  {
    id: "wma", name: "WMA (Weighted Moving Average)", nameZh: "WMA 加权移动平均", short: "WMA", category: "trend", placement: "main",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "wma", color: C.cyan }],
    compute: (i, p) => ({ wma: computeWMA(i.close, p.period) }),
  },
  {
    id: "hma", name: "Hull Moving Average (HMA)", nameZh: "赫尔均线 Hull MA", short: "HMA", category: "trend", placement: "main",
    params: [p1("period", "Period", 9)],
    plots: [{ key: "hma", color: C.fuchsia }],
    compute: (i, p) => ({ hma: computeHullMA(i.close, p.period) }),
  },
  {
    id: "dema", name: "DEMA (Double Exponential Moving Average)", nameZh: "DEMA 双重指数均线", short: "DEMA", category: "trend", placement: "main",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "dema", color: C.rose }],
    compute: (i, p) => ({ dema: computeDEMA(i.close, p.period) }),
  },
  {
    id: "tema", name: "TEMA (Triple Exponential Moving Average)", nameZh: "TEMA 三重指数均线", short: "TEMA", category: "trend", placement: "main",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "tema", color: C.green }],
    compute: (i, p) => ({ tema: computeTEMA(i.close, p.period) }),
  },
  {
    id: "vwma", name: "VWMA (Volume Weighted Moving Average)", nameZh: "VWMA 成交量加权均线", short: "VWMA", category: "trend", placement: "main",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "vwma", color: C.teal }],
    compute: (i, p) => ({ vwma: computeVWMA(i.close, i.volume, p.period) }),
  },
  {
    id: "vwap", name: "VWAP (Volume Weighted Average Price)", nameZh: "VWAP 成交量加权均价", short: "VWAP", category: "trend", placement: "main",
    params: [],
    plots: [{ key: "vwap", color: C.yellow }],
    compute: (i) => ({ vwap: computeVWAP(i.high, i.low, i.close, i.volume) }),
    legendParams: () => "",
  },
  {
    id: "sar", name: "Parabolic SAR", nameZh: "抛物线 SAR", short: "SAR", category: "trend", placement: "main",
    params: [
      { key: "step", label: "Step", default: 0.02, min: 0.001, max: 1, step: 0.01 },
      { key: "max", label: "Max", default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    plots: [{ key: "sar", color: C.fuchsia, kind: "dots" }],
    compute: (i, p) => ({ sar: computeParabolicSAR(i.high, i.low, p.step, p.max) }),
  },
  {
    id: "supertrend", name: "SuperTrend", nameZh: "SuperTrend", short: "ST", category: "trend", placement: "main",
    params: [
      p1("period", "ATR Period", 10),
      { key: "multiplier", label: "Multiplier", default: 3, min: 0.5, max: 20, step: 0.5 },
    ],
    plots: [{ key: "st", color: C.up, lineWidth: 2 }],
    compute: (i, p) => ({
      st: computeSuperTrend(i.high, i.low, i.close, p.period, p.multiplier).value,
    }),
  },
  {
    id: "ichimoku", name: "Ichimoku Cloud", nameZh: "一目均衡表", short: "Ichimoku", category: "trend", placement: "main",
    params: [p1("tenkan", "Conversion Line", 9), p1("kijun", "Base Line", 26), p1("senkouB", "Leading Span B", 52)],
    plots: [
      { key: "tenkan", label: "Conversion Line", color: C.rose },
      { key: "kijun", label: "Base Line", color: C.blue },
      { key: "senkouA", label: "Leading Span A", color: "rgba(34,197,94,0.45)" },
      { key: "senkouB", label: "Leading Span B", color: "rgba(239,68,68,0.45)" },
    ],
    compute: (i, p) => {
      const r = computeIchimoku(i.high, i.low, p.tenkan, p.kijun, p.senkouB);
      return { tenkan: r.tenkan, kijun: r.kijun, senkouA: r.senkouA, senkouB: r.senkouB };
    },
  },
  {
    id: "alligator", name: "Williams Alligator", nameZh: "鳄鱼线 Williams Alligator", short: "Alligator", category: "trend", placement: "main",
    params: [
      p1("jawPeriod", "Jaw Period", 13), p1("jawShift", "Jaw Shift", 8),
      p1("teethPeriod", "Teeth Period", 8), p1("teethShift", "Teeth Shift", 5),
      p1("lipsPeriod", "Lips Period", 5), p1("lipsShift", "Lips Shift", 3),
    ],
    plots: [
      { key: "jaw", label: "Jaw", color: C.blue },
      { key: "teeth", label: "Teeth", color: C.rose },
      { key: "lips", label: "Lips", color: C.green },
    ],
    compute: (i, p) => {
      const r = computeAlligator(i.high, i.low, p.jawPeriod, p.jawShift, p.teethPeriod, p.teethShift, p.lipsPeriod, p.lipsShift);
      return { jaw: r.jaw, teeth: r.teeth, lips: r.lips };
    },
  },
  {
    id: "adx", name: "ADX (Average Directional Index)", nameZh: "ADX 平均趋向指标", short: "ADX", category: "trend", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [{ key: "adx", color: C.orange }],
    compute: (i, p) => ({ adx: computeADX(i.high, i.low, i.close, p.period) }),
    guides: [20, 25],
  },
  {
    id: "aroon", name: "Aroon", nameZh: "Aroon 阿隆指标", short: "Aroon", category: "trend", placement: "pane",
    params: [p1("period", "Period", 25)],
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
  {
    id: "vortex", name: "Vortex Indicator", nameZh: "涡旋指标 Vortex Indicator", short: "Vortex", category: "trend", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [
      { key: "viPlus", label: "VI+", color: C.up },
      { key: "viMinus", label: "VI-", color: C.down },
    ],
    compute: (i, p) => {
      const r = computeVortex(i.high, i.low, i.close, p.period);
      return { viPlus: r.viPlus, viMinus: r.viMinus };
    },
    guides: [1],
  },

  // ---------------- Volatility ----------------
  {
    id: "bb", name: "Bollinger Bands", nameZh: "布林带 Bollinger Bands", short: "BB", category: "volatility", placement: "main",
    params: [
      p1("period", "Period", 20),
      { key: "multiplier", label: "StdDev Multiplier", default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    plots: [
      { key: "upper", label: "Upper Band", color: C.bandGold, lineStyle: 2 },
      { key: "middle", label: "Middle Band", color: C.bandGold },
      { key: "lower", label: "Lower Band", color: C.bandGold, lineStyle: 2 },
    ],
    compute: (i, p) => {
      const r = computeBollingerBands(i.close, p.period, p.multiplier);
      return { upper: r.upper, middle: r.middle, lower: r.lower };
    },
  },
  {
    id: "kc", name: "Keltner Channels", nameZh: "肯特纳通道 Keltner", short: "KC", category: "volatility", placement: "main",
    params: [
      p1("period", "EMA Period", 20), p1("atrPeriod", "ATR Period", 10),
      { key: "multiplier", label: "Multiplier", default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    plots: [
      { key: "upper", label: "Upper Band", color: C.bandBlue, lineStyle: 2 },
      { key: "lower", label: "Lower Band", color: C.bandBlue, lineStyle: 2 },
    ],
    compute: (i, p) => {
      const r = computeKeltnerChannels(i.high, i.low, i.close, p.period, p.atrPeriod, p.multiplier);
      return { upper: r.upper, lower: r.lower };
    },
  },
  {
    id: "donchian", name: "Donchian Channels", nameZh: "唐奇安通道 Donchian", short: "DC", category: "volatility", placement: "main",
    params: [p1("period", "Period", 20)],
    plots: [
      { key: "upper", label: "Upper Band", color: C.bandLime },
      { key: "lower", label: "Lower Band", color: C.bandLime },
    ],
    compute: (i, p) => {
      const r = computeDonchianChannels(i.high, i.low, p.period);
      return { upper: r.upper, lower: r.lower };
    },
  },
  {
    id: "pivots", name: "Pivot Points", nameZh: "枢轴点 Pivot Points", short: "Pivots", category: "trend", placement: "main",
    params: [],
    plots: [
      { key: "pivot", label: "P", color: C.yellow },
      { key: "r1", label: "R1", color: C.down },
      { key: "s1", label: "S1", color: C.up },
      { key: "r2", label: "R2", color: C.down, lineStyle: 1 },
      { key: "s2", label: "S2", color: C.up, lineStyle: 1 },
    ],
    compute: (i) => {
      const r = computePivotPoints(i.high, i.low, i.close);
      return { pivot: r.pivot, r1: r.r1, s1: r.s1, r2: r.r2, s2: r.s2 };
    },
    legendParams: () => "",
  },
  {
    id: "envelope", name: "Envelope (Percentage Channel)", nameZh: "Envelope 百分比通道", short: "ENV", category: "volatility", placement: "main",
    params: [
      p1("period", "Period", 20),
      { key: "percent", label: "Percent", default: 2.5, min: 0.1, max: 50, step: 0.1 },
    ],
    plots: [
      { key: "upper", label: "Upper Band", color: C.bandViolet, lineStyle: 2 },
      { key: "lower", label: "Lower Band", color: C.bandViolet, lineStyle: 2 },
    ],
    compute: (i, p) => {
      const r = computeEnvelope(i.close, p.period, p.percent);
      return { upper: r.upper, lower: r.lower };
    },
  },
  {
    id: "atr", name: "ATR (Average True Range)", nameZh: "ATR 平均真实波幅", short: "ATR", category: "volatility", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [{ key: "atr", color: C.lime }],
    compute: (i, p) => ({ atr: computeATR(i.high, i.low, i.close, p.period) }),
  },
  {
    id: "stddev", name: "Standard Deviation", nameZh: "标准差 StdDev", short: "StdDev", category: "volatility", placement: "pane",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "sd", color: C.lime }],
    compute: (i, p) => ({ sd: computeStdDev(i.close, p.period) }),
  },

  // ---------------- Momentum ----------------
  {
    id: "rsi", name: "RSI (Relative Strength Index)", nameZh: "RSI 相对强弱指标", short: "RSI", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [{ key: "rsi", color: C.purple }],
    compute: (i, p) => ({ rsi: computeRSI(i.close, p.period) }),
    guides: [30, 50, 70],
  },
  {
    id: "macd", name: "MACD (Moving Average Convergence Divergence)", nameZh: "MACD 指数平滑异同", short: "MACD", category: "momentum", placement: "pane",
    params: [p1("fast", "Fast Line", 12), p1("slow", "Slow Line", 26), p1("signal", "Signal", 9)],
    plots: [
      {
        key: "hist", label: "Histogram", color: C.up, kind: "histogram",
        barColor: ({ value }) => (value >= 0 ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"),
      },
      { key: "macd", label: "MACD", color: C.blue },
      { key: "signal", label: "Signal", color: C.amber },
    ],
    compute: (i, p) => {
      const r = computeMACD(i.close, p.fast, p.slow, p.signal);
      return { macd: r.macd, signal: r.signal, hist: r.histogram };
    },
    guides: [0],
  },
  {
    id: "stoch", name: "Stochastic Oscillator", nameZh: "随机指标 Stochastic", short: "Stoch", category: "momentum", placement: "pane",
    params: [p1("k", "%K Period", 14), p1("d", "%D Period", 3)],
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
    id: "kdj", name: "KDJ", nameZh: "KDJ 随机指标", short: "KDJ", category: "momentum", placement: "pane",
    params: [
      p1("period", "Period", 9),
      { key: "kSmooth", label: "K Smoothing", default: 3, min: 1, max: 20, step: 1 },
      { key: "dSmooth", label: "D Smoothing", default: 3, min: 1, max: 20, step: 1 },
    ],
    plots: [
      { key: "k", label: "K", color: C.blue },
      { key: "d", label: "D", color: C.amber },
      { key: "j", label: "J", color: C.purple },
    ],
    compute: (i, p) => {
      const r = computeKDJ(i.high, i.low, i.close, p.period, p.kSmooth, p.dSmooth);
      return { k: r.k, d: r.d, j: r.j };
    },
    guides: [20, 80],
  },
  {
    id: "stochrsi", name: "Stochastic RSI", nameZh: "随机 RSI Stochastic RSI", short: "StochRSI", category: "momentum", placement: "pane",
    params: [
      p1("rsiPeriod", "RSI Period", 14),
      p1("stochPeriod", "Stochastic Period", 14),
      { key: "kSmooth", label: "K Smoothing", default: 3, min: 1, max: 20, step: 1 },
      { key: "dSmooth", label: "D Smoothing", default: 3, min: 1, max: 20, step: 1 },
    ],
    plots: [
      { key: "k", label: "%K", color: C.blue },
      { key: "d", label: "%D", color: C.amber },
    ],
    compute: (i, p) => {
      const r = computeStochRSI(i.close, p.rsiPeriod, p.stochPeriod, p.kSmooth, p.dSmooth);
      return { k: r.k, d: r.d };
    },
    guides: [20, 80],
  },
  {
    id: "cci", name: "CCI (Commodity Channel Index)", nameZh: "CCI 顺势指标", short: "CCI", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "cci", color: C.cyan }],
    compute: (i, p) => ({ cci: computeCCI(i.high, i.low, i.close, p.period) }),
    guides: [-100, 0, 100],
  },
  {
    id: "willr", name: "Williams %R", nameZh: "威廉 %R", short: "%R", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [{ key: "r", color: C.pink }],
    compute: (i, p) => ({ r: computeWilliamsR(i.high, i.low, i.close, p.period) }),
    guides: [-80, -20],
  },
  {
    id: "ao", name: "Awesome Oscillator", nameZh: "动量振荡指标 Awesome Oscillator", short: "AO", category: "momentum", placement: "pane",
    params: [
      p1("fastPeriod", "Fast Period", 5),
      p1("slowPeriod", "Slow Period", 34),
    ],
    plots: [
      {
        key: "ao", label: "AO", color: C.up, kind: "histogram",
        barColor: ({ i, value, input }) => {
          const prevMedian = i > 0 ? (input.high[i - 1] + input.low[i - 1]) / 2 : (input.high[i] + input.low[i]) / 2;
          const median = (input.high[i] + input.low[i]) / 2;
          void value;
          return median >= prevMedian ? C.up : C.down;
        },
      },
    ],
    compute: (i, p) => ({ ao: computeAwesomeOscillator(i.high, i.low, p.fastPeriod, p.slowPeriod) }),
    guides: [0],
  },
  {
    id: "momentum", name: "Momentum", nameZh: "动量指标 Momentum", short: "MOM", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 10)],
    plots: [{ key: "mom", color: C.indigo }],
    compute: (i, p) => ({ mom: computeMomentum(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "roc", name: "ROC (Rate of Change)", nameZh: "ROC 变动率", short: "ROC", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 12)],
    plots: [{ key: "roc", color: C.pink }],
    compute: (i, p) => ({ roc: computeROC(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "trix", name: "TRIX", nameZh: "TRIX 三重指数平滑", short: "TRIX", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 15)],
    plots: [{ key: "trix", color: C.blue }],
    compute: (i, p) => ({ trix: computeTRIX(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "cmo", name: "Chande Momentum Oscillator (CMO)", nameZh: "钱德动量摆动指标 CMO", short: "CMO", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [{ key: "cmo", color: C.orange }],
    compute: (i, p) => ({ cmo: computeCMO(i.close, p.period) }),
    guides: [-50, 0, 50],
  },
  {
    id: "dpo", name: "DPO (Detrended Price Oscillator)", nameZh: "DPO 区间震荡指标", short: "DPO", category: "momentum", placement: "pane",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "dpo", color: C.sky }],
    compute: (i, p) => ({ dpo: computeDPO(i.close, p.period) }),
    guides: [0],
  },
  {
    id: "uo", name: "Ultimate Oscillator", nameZh: "终极震荡指标 UO", short: "UO", category: "momentum", placement: "pane",
    params: [p1("p1", "Period 1", 7), p1("p2", "Period 2", 14), p1("p3", "Period 3", 28)],
    plots: [{ key: "uo", color: C.purple }],
    compute: (i, p) => ({
      uo: computeUltimateOscillator(i.high, i.low, i.close, p.p1, p.p2, p.p3),
    }),
    guides: [30, 70],
  },

  // ---------------- Volume ----------------
  {
    id: "volume", name: "Volume", nameZh: "成交量 Volume", short: "Vol", category: "volume", placement: "pane",
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
    id: "obv", name: "OBV (On-Balance Volume)", nameZh: "OBV 能量潮", short: "OBV", category: "volume", placement: "pane",
    params: [],
    plots: [{ key: "obv", color: C.sky }],
    compute: (i) => ({ obv: computeOBV(i.close, i.volume) }),
    legendParams: () => "",
  },
  {
    id: "mfi", name: "MFI (Money Flow Index)", nameZh: "MFI 资金流量指标", short: "MFI", category: "volume", placement: "pane",
    params: [p1("period", "Period", 14)],
    plots: [{ key: "mfi", color: C.yellow }],
    compute: (i, p) => ({ mfi: computeMFI(i.high, i.low, i.close, i.volume, p.period) }),
    guides: [20, 80],
  },
  {
    id: "cmf", name: "Chaikin Money Flow (CMF)", nameZh: "佳庆资金流量 CMF", short: "CMF", category: "volume", placement: "pane",
    params: [p1("period", "Period", 20)],
    plots: [{ key: "cmf", color: C.teal }],
    compute: (i, p) => ({ cmf: computeCMF(i.high, i.low, i.close, i.volume, p.period) }),
    guides: [0],
  },
  {
    id: "chaikinosc", name: "Chaikin Oscillator", nameZh: "佳庆振荡器 Chaikin Oscillator", short: "ChaikinOsc", category: "volume", placement: "pane",
    params: [p1("fastPeriod", "Fast Period", 3), p1("slowPeriod", "Slow Period", 10)],
    plots: [{ key: "chaikinosc", color: C.indigo }],
    compute: (i, p) => ({ chaikinosc: computeChaikinOscillator(i.high, i.low, i.close, i.volume, p.fastPeriod, p.slowPeriod) }),
    guides: [0],
  },

  // ---------------- Derivatives (CoinGlass) ----------------
  // 这两个不是从 OHLCV 算出来的，而是 KlineChart 按 `requires` 向
  // /api/coinglass/series 拉来、对齐到 K 线数组后经 input.ext 交进来的。
  // 没有 ext（周期 <30m、还没加载完、上游失败）时输出全 null——图表上是空副图
  // 加图例提示，而不是报错。
  {
    id: "cg_oi", name: "Aggregated Open Interest (CoinGlass)", nameZh: "聚合持仓量 OI (CoinGlass)", short: "OI", category: "derivatives", placement: "pane",
    params: [],
    plots: [{ key: "oi", label: "Open Interest", color: C.up, kind: "candles" }],
    compute: (i) => ({ oi: i.ext?.series ?? emptyCandles(i.close.length) }),
    requires: ["oi"],
    source: "coinglass",
    settings: [
      CG_SYMBOL_MODE, CG_SYMBOL,
      {
        key: "margin", label: "Margin type", labelZh: "保证金类型", type: "select", default: "coin",
        options: [
          { value: "coin", label: "COIN-margined", labelZh: "币本位" },
          { value: "stablecoin", label: "USDT-margined", labelZh: "U 本位" },
          { value: "all", label: "All (no exchange filter)", labelZh: "全部（不可筛交易所）" },
        ],
      },
      CG_UNIT,
      { ...CG_EXCHANGE_MODE, showWhen: { key: "margin", in: ["coin", "stablecoin"] } },
      { ...CG_EXCHANGES, options: toOptions(FUTURES_EXCHANGE_CHOICES) },
      CG_DISPLAY, CG_LINE_SOURCE,
    ],
    legendParams: () => "",
    legendSettings: (s) => cgLegend(s, { coin: "币本位", stablecoin: "U本位", all: "全部" }, "margin"),
  },
  {
    id: "cg_cvd", name: "Aggregated Futures CVD (CoinGlass)", nameZh: "聚合合约 CVD 主动买卖差 (CoinGlass)", short: "CVD", category: "derivatives", placement: "pane",
    params: [],
    plots: [{ key: "cvd", label: "CVD", color: C.blue, kind: "candles" }],
    compute: (i) => ({ cvd: i.ext?.series ?? emptyCandles(i.close.length) }),
    requires: ["cvd"],
    source: "coinglass",
    guides: [0],
    settings: [
      CG_SYMBOL_MODE, CG_SYMBOL,
      {
        key: "market", label: "Market", labelZh: "市场", type: "select", default: "futures",
        options: [
          { value: "spot", label: "Spot", labelZh: "现货" },
          { value: "futures", label: "Futures", labelZh: "合约" },
        ],
      },
      CG_UNIT,
      CG_EXCHANGE_MODE,
      {
        ...CG_EXCHANGES,
        options: (s) => toOptions(s.market === "futures" ? FUTURES_EXCHANGE_CHOICES : SPOT_EXCHANGE_CHOICES),
      },
      CG_DISPLAY, CG_LINE_SOURCE,
    ],
    legendParams: () => "",
    legendSettings: (s) => cgLegend(s, { spot: "现货", futures: "合约" }, "market"),
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

/** Default params for a definition, used when adding a fresh instance. */
export function defaultParams(def: IndicatorDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Default settings (non-numeric) for a definition; {} when it declares none. */
export function defaultSettings(def: IndicatorDef): Record<string, ExternalSettingValue> {
  const out: Record<string, ExternalSettingValue> = {};
  for (const sdef of def.settings ?? []) out[sdef.key] = Array.isArray(sdef.default) ? [...sdef.default] : sdef.default;
  return out;
}

/**
 * Whether a setting is currently shown. A setting is hidden when its `showWhen`
 * condition fails **or** when the setting it depends on is itself hidden
 * (exchanges → exchangeMode → margin: picking "all" margin hides both).
 */
export function settingVisible(
  sdef: SettingDef,
  settings: Record<string, ExternalSettingValue> | undefined,
  allDefs: SettingDef[] = []
): boolean {
  if (!sdef.showWhen) return true;
  const v = settings?.[sdef.showWhen.key];
  if (!(typeof v === "string" && sdef.showWhen.in.includes(v))) return false;
  const parent = allDefs.find((d) => d.key === sdef.showWhen!.key);
  return parent ? settingVisible(parent, settings, allDefs) : true;
}

/** Resolve a multiselect's option list (static or derived from other settings). */
export function settingOptions(sdef: SettingDef, settings: Record<string, ExternalSettingValue> | undefined): SettingOption[] {
  if (sdef.type === "text") return [];
  return typeof sdef.options === "function" ? sdef.options(settings ?? {}) : sdef.options;
}

/** Legend label, e.g. "MA 20" or "MACD 12 26 9"; CoinGlass entries append a settings summary. */
export function legendLabel(
  def: IndicatorDef,
  params: Record<string, number>,
  settings?: Record<string, ExternalSettingValue>
): string {
  let base: string;
  if (def.legendParams) {
    const suffix = def.legendParams(params);
    base = suffix ? `${def.short} ${suffix}` : def.short;
  } else {
    const vals = def.params.map((p) => params[p.key]).filter((v) => v !== undefined);
    base = vals.length ? `${def.short} ${vals.join(" ")}` : def.short;
  }
  if (def.legendSettings && settings) {
    const extra = def.legendSettings(settings);
    if (extra) return `${base} ${extra}`;
  }
  return base;
}

/** A single plot's overridable style fields — mirrors the relevant subset of PlotDef. */
export interface PlotStyleOverride {
  color?: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 0 | 1 | 2 | 3 | 4;
  // ---- 蜡烛 plot 专用（TradingView「样式」页的那组） ----
  upColor?: string;
  downColor?: string;
  borderUpColor?: string;
  borderDownColor?: string;
  wickUpColor?: string;
  wickDownColor?: string;
  /** 价格轴上的最新值标签 */
  lastValueVisible?: boolean;
  /** 最新值水平线 */
  priceLineVisible?: boolean;
  /** 刻度小数位；undefined = 默认 2 */
  precision?: 0 | 1 | 2 | 3 | 4;
}

export interface ResolvedCandleStyle {
  upColor: string;
  downColor: string;
  borderUpColor: string;
  borderDownColor: string;
  wickUpColor: string;
  wickDownColor: string;
  lastValueVisible: boolean;
  priceLineVisible: boolean;
  precision: 0 | 1 | 2 | 3 | 4;
}

/**
 * 蜡烛 plot 的有效样式：实体色默认主图涨跌色，边框/影线默认跟随实体色
 * （用户没单独设过就随实体变）。
 *
 * 最新值标签与价格线默认**开**——与主图蜡烛一致（右轴那个高亮的当前值方块
 * 加一条横向虚线）。没有它，副图右轴只有几个刻度，读当前 OI / CVD 到底是多少
 * 得靠眼睛在刻度间估。两项都能在「样式」页各自关掉。
 */
export function resolveCandleStyle(
  overrides: Record<string, PlotStyleOverride> | undefined,
  plotKey: string
): ResolvedCandleStyle {
  const o = overrides?.[plotKey] ?? {};
  const up = o.upColor ?? CHART.up;
  const down = o.downColor ?? CHART.down;
  return {
    upColor: up,
    downColor: down,
    borderUpColor: o.borderUpColor ?? up,
    borderDownColor: o.borderDownColor ?? down,
    wickUpColor: o.wickUpColor ?? up,
    wickDownColor: o.wickDownColor ?? down,
    lastValueVisible: o.lastValueVisible ?? true,
    priceLineVisible: o.priceLineVisible ?? true,
    precision: o.precision ?? 2,
  };
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
