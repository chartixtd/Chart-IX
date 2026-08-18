import type { CoinGlassLiquidationBar, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";

/** 峰值达到基线的几倍才开始给分 */
export const SWEEP_SPIKE_MIN = 3;

/** 峰值达到基线的几倍拿满峰值分 */
export const SWEEP_SPIKE_FULL = 10;

/** 只看最近几根 30 分钟——sweep 是个生命周期几十分钟的事件，两小时之前的不算数 */
export const SWEEP_RECENT_BARS = 4;

/**
 * 基线的绝对下限，美元。
 *
 * 小市值币的 48 根 30m 爆仓序列里超过一半是 0 是常态，中位数因此经常正好为 0，
 * 直接相除会得到 Infinity，让任何一笔几百美元的爆仓拿满分。
 * 实际用的基线取「中位数、总额/根数、这个绝对下限」三者中的最大值：
 * 前两者让门槛随币自身的爆仓体量缩放，最后一个兜住整条序列全 0 的币。
 */
export const SWEEP_BASELINE_FLOOR_USD = 1000;

/** 峰值强度分上限（满分 20 里的 12） */
const SPIKE_MAX = 12;

/** 收回确认分上限（满分 20 里的 8） */
const RECOVER_MAX = 8;

/** 下影/上影至少要占全长这么多才算「插针」 */
const WICK_MIN_RATIO = 0.4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 最近 SWEEP_RECENT_BARS 根里的最大值相对全序列基线的倍数，以及它的下标。
 * 基线用中位数而不是均值：峰值会把均值自己抬上去，一次 90 倍的插针
 * 用均值算出来只有 7 倍，正好被起分线挡在门外。
 */
export function spikeRatio(series: number[]): { ratio: number; index: number } {
  if (series.length === 0) return { ratio: 0, index: -1 };

  const total = series.reduce((a, b) => a + b, 0);
  const med = median(series);
  // 中位数为 0 才回落到均值：小市值币的 48 根序列里过半是 0 是常态，
  // 那种情况下中位数不携带任何信息，用均值让门槛随该币自身的爆仓体量缩放。
  // 但中位数非 0 时**绝不能**再和均值取 max —— 只要序列里有峰值，
  // 均值必然大于中位数，max 会永远取到均值，这条曲线就退化成了
  // 它本来要避免的「用均值当基线」，一次 90 倍的插针会被算成 7 倍。
  const scale = med > 0 ? med : total / series.length;
  const baseline = Math.max(scale, SWEEP_BASELINE_FLOOR_USD);

  const from = Math.max(0, series.length - SWEEP_RECENT_BARS);
  let index = from;
  for (let i = from + 1; i < series.length; i++) if (series[i] > series[index]) index = i;

  return { ratio: series[index] / baseline, index };
}

/** spike 从 SWEEP_SPIKE_MIN 起给分、SWEEP_SPIKE_FULL 满分，中间走对数刻度。 */
function spikeToScore(ratio: number): number {
  if (ratio <= SWEEP_SPIKE_MIN) return 0;
  if (ratio >= SWEEP_SPIKE_FULL) return SPIKE_MAX;
  const t =
    (Math.log(ratio) - Math.log(SWEEP_SPIKE_MIN)) /
    (Math.log(SWEEP_SPIKE_FULL) - Math.log(SWEEP_SPIKE_MIN));
  return t * SPIKE_MAX;
}

/**
 * 收回确认：峰值那根 K 线要有足够长的顺向影线，且收盘已经离开影线尖端。
 * 做多看下影（下方止损被扫干净后价格收回），做空看上影。
 */
function recoverScore(bar: CoinGlassPriceBar | undefined, direction: Direction): number {
  if (!bar) return 0;
  const high = parseFloat(bar.high);
  const low = parseFloat(bar.low);
  const open = parseFloat(bar.open);
  const close = parseFloat(bar.close);
  if (![high, low, open, close].every(Number.isFinite)) return 0;

  const range = high - low;
  if (range <= 0) return 0;

  const bodyLow = Math.min(open, close);
  const bodyHigh = Math.max(open, close);
  const wick = direction === "long" ? (bodyLow - low) / range : (high - bodyHigh) / range;
  if (wick < WICK_MIN_RATIO) return 0;

  // 收盘在整根区间里的位置：做多要靠上，做空要靠下
  const closePos = (close - low) / range;
  const recovered = direction === "long" ? closePos : 1 - closePos;
  if (recovered < 0.5) return 0;

  const wickPart = Math.min(1, (wick - WICK_MIN_RATIO) / (1 - WICK_MIN_RATIO));
  const recoverPart = (recovered - 0.5) / 0.5;
  return RECOVER_MAX * (0.5 * wickPart + 0.5 * recoverPart);
}

/**
 * 「没数据」与「真的是 0」在 Sweep 上语义相同，都给 0 分。
 *
 * 它是「发生了某件事」的事件型因子，没发生就是没发生。这与 Zone/OI/CVD
 * 那种「拿不到数据走中性分」的状态型因子**正好相反**——不要为了统一
 * 而把这里也改成中性分，那会让一批完全没有扫单的币白拿 10 分。
 */
export function sweepScore(
  liq: CoinGlassLiquidationBar[],
  bars: CoinGlassPriceBar[],
  direction: Direction
): number {
  if (liq.length === 0) return 0;

  const series = liq.map((b) =>
    parseFloat(direction === "long" ? b.long_liquidation_usd : b.short_liquidation_usd)
  );
  if (series.some((v) => !Number.isFinite(v))) return 0;

  const { ratio, index } = spikeRatio(series);
  const spikePart = spikeToScore(ratio);
  if (spikePart <= 0) return 0;

  // 爆仓序列与 K 线序列都取自同一交易所、同一 30m 粒度、同样 48 根，
  // 所以下标可以直接对齐；长度不一致时按「距末尾多少根」对齐更稳。
  const offsetFromEnd = series.length - 1 - index;
  const bar = bars[bars.length - 1 - offsetFromEnd];

  return Math.max(0, Math.min(FACTOR_MAX.sweep, spikePart + recoverScore(bar, direction)));
}
