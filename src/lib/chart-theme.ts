/**
 * 图表配色 —— JS 侧的单一真源。
 *
 * lightweight-charts 与 SVG 覆盖层都拿不到 Tailwind class，只能吃 JS 常量。
 * 在这套常量出现之前，K 线用的是一整套冷灰 + Tailwind 默认红绿
 * （#22c55e / #ef4444 / #1a1a1a / #666666），和站内暖黑曜石色板是两个世界——
 * 交易终端因此看起来像另一个产品。
 *
 * 这里的每个值都必须和 tailwind.config.ts 的 token 对齐；改色板时两边一起改。
 */
export const CHART = {
  /** = success token。涨 */
  up: "#34C77B",
  /** = danger token。跌 */
  down: "#E85055",
  /** = gold token。选中、当前价、金色强调 */
  gold: "#C9A24B",
  /** = text-muted（已修正到 5.15:1）。坐标轴刻度文字 */
  axisText: "#8A8172",
  /** = bg-tertiary。网格线——低对比，不与数据争视觉 */
  grid: "#1C1913",
  /** = border-default。轴线、面板分隔 */
  border: "#2C271C",
  /** = border-hover。十字线 */
  crosshair: "#3A3325",
  /** = bg-primary。画在金色标签上的深色文字 */
  ink: "#0B0A08",
} as const;

/**
 * 恐惧贪婪指数的五段暖色带。
 * 原来那条 ef4444→f97316→eab308→84cc16→22c55e 是 Tailwind 默认色，
 * 冷绿冷黄在暖底上会发脏。这条把整条色带拉回暖调，两端仍是站内的涨跌语义色。
 */
export const SENTIMENT_RAMP = [
  { max: 25, color: "#E85055" }, // extreme fear  = danger
  { max: 45, color: "#E0783B" }, // fear          = 暖橙
  { max: 55, color: "#E0A93B" }, // neutral       = warning
  { max: 75, color: "#96BF4D" }, // greed         = 暖黄绿
  { max: 100, color: "#34C77B" }, // extreme greed = success
] as const;

export function sentimentColor(value: number): string {
  return (SENTIMENT_RAMP.find((s) => value <= s.max) ?? SENTIMENT_RAMP[4]).color;
}

/**
 * 等宽字栈。canvas 与 SVG 里 font-family 写 "monospace" 会各系统解析成不同字体
 * （macOS Courier / Linux DejaVu），价格标签宽度对不上。显式给一条覆盖三大系统的栈。
 */
export const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "Courier New", monospace';
