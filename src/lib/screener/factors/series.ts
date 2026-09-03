import type { CoinGlassPriceBar, CoinGlassOiBar, CoinGlassTakerBar } from "@/lib/coinglass/types";
import { toFiniteNumber } from "@/lib/coinglass/types";
import { findPivots, PIVOT_N } from "./oi-divergence";

/**
 * 三变量判读的公共底座：把三条原始序列变成可以互相比较的形状。
 *
 * 规格里反复强调的一句话是「**用 swing 比较，不用单根颜色**」——判 CVD
 * 强弱不能看某一根是红是青，要看它自己的摆动高低点有没有抬高/降低。
 * 这要求 CVD 必须先累积成一条**线**（旧代码只按窗口求净流，没有线，
 * 也就无从谈它自己的 swing）。
 *
 * 三条序列逐根同下标同时刻是所有判定的前提，由流水线保证（同长度同粒度
 * 一起拉，见 pipeline.ts 明细层）。这里的每个函数都只按下标工作，
 * 不自己去对齐时间——对齐错了应该在上游炸，不该在这里被悄悄兜住。
 */

/** OI 变化的分档门槛（%）。「暴增/暴减」是陷阱判定的入口词，必须能量化。 */
export const OI_FLAT_PCT = 1;
export const OI_SURGE_PCT = 7;

/** CVD 净流占换手的分档门槛（%）。「剧烈」同上。 */
export const CVD_ALIGN_PCT = 2;
export const CVD_EXTREME_PCT = 10;

/**
 * CVD 累积线。
 *
 * 第 i 项 = 从序列开头到第 i 根为止的 (主动买 − 主动卖) 累加。绝对值本身
 * 没有意义（起点是任意的），有意义的是它的**形状**：抬高、降低、背离。
 *
 * 任何一根算不出来就整条返回 null——CVD 线是累积的，中间断一根，
 * 后面每一根都带着这个缺口，比值和 swing 全是错的。
 */
export function cvdLine(taker: CoinGlassTakerBar[]): number[] | null {
  const out: number[] = [];
  let acc = 0;
  for (const b of taker) {
    const buy = toFiniteNumber(b.aggregated_buy_volume_usd);
    const sell = toFiniteNumber(b.aggregated_sell_volume_usd);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    acc += buy - sell;
    out.push(acc);
  }
  return out;
}

/** 每根的总换手（买+卖），用来把 CVD 的绝对金额换算成占比。 */
export function grossLine(taker: CoinGlassTakerBar[]): number[] {
  return taker.map((b) => {
    const buy = toFiniteNumber(b.aggregated_buy_volume_usd);
    const sell = toFiniteNumber(b.aggregated_sell_volume_usd);
    return Number.isFinite(buy) && Number.isFinite(sell) ? buy + sell : NaN;
  });
}

export function highs(bars: CoinGlassPriceBar[]): number[] {
  return bars.map((b) => parseFloat(b.high));
}
export function lows(bars: CoinGlassPriceBar[]): number[] {
  return bars.map((b) => parseFloat(b.low));
}
export function closes(bars: CoinGlassPriceBar[]): number[] {
  return bars.map((b) => parseFloat(b.close));
}
export function oiCloses(bars: CoinGlassOiBar[]): number[] {
  return bars.map((b) => toFiniteNumber(b.close));
}

/**
 * 一条序列最后两个已确认摆动点的下标。不足两个返回 null。
 *
 * 「已确认」= findPivots 的定义：左右各 PIVOT_N 根都没有更极端的值。
 * 代价是最新的 PIVOT_N 根永远不可能成为摆动点（右侧还没走完），
 * 也就是所有基于摆动点的判定天生带 2.5 小时确认延迟。这是规格
 * 「用 swing 比较」必然要付的成本，不是实现缺陷。
 */
export function lastTwoPivots(
  values: number[],
  kind: "high" | "low",
  n: number = PIVOT_N
): { prev: number; curr: number } | null {
  const p = findPivots(values, n, kind);
  if (p.length < 2) return null;
  return { prev: p[p.length - 2], curr: p[p.length - 1] };
}

/**
 * 这条序列在最后两个摆动点之间**有没有创出新极值**。
 *
 * 这是 E1/E4/E5/E8 四个状态的唯一判据。规格给的定义是纯结构的
 * （「CVD 创新低 + 价格未创新低 → E1」），不需要把「跌得比价格多」
 * 换算成某种可比的幅度——那句话是**解释**，不是判据。
 *
 * 这一点值得写下来，因为按幅度去实现是很自然的错误想法：价格的跌幅是
 * 百分比，CVD 的跌幅是美元净流，两者没有公分母，任何「谁跌得多」的
 * 数值比较都得先编造一个归一化口径，而那个口径会决定结果。
 */
export function madeNewExtreme(
  values: number[],
  kind: "high" | "low",
  n: number = PIVOT_N
): boolean | null {
  const pv = lastTwoPivots(values, kind, n);
  if (!pv) return null;
  const a = values[pv.prev];
  const b = values[pv.curr];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return kind === "high" ? b > a : b < a;
}

/** 区间 (from, to] 的变化率 %。分母非正或算不出来返回 null。 */
export function pctChange(values: number[], from: number, to: number): number | null {
  const a = values[from];
  const b = values[to];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  const pct = ((b - a) / a) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/**
 * 区间 (from, to] 的 CVD 净流占换手 %。
 *
 * 用占比而不是绝对美元：绝对值没法跨币比较，也没法定「剧烈」的门槛。
 * 从 from 的**下一根**开始累加——from 那一根属于更早一段行情。
 */
export function cvdNetPct(taker: CoinGlassTakerBar[], from: number, to: number): number | null {
  let net = 0;
  let gross = 0;
  for (let k = from + 1; k <= to; k++) {
    const b = taker[k];
    if (!b) return null;
    const buy = toFiniteNumber(b.aggregated_buy_volume_usd);
    const sell = toFiniteNumber(b.aggregated_sell_volume_usd);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    net += buy - sell;
    gross += buy + sell;
  }
  if (gross <= 0) return null;
  const pct = (net / gross) * 100;
  return Number.isFinite(pct) ? pct : null;
}

export type OiState = "surge" | "up" | "flat" | "down" | "plunge";

/**
 * OI 在区间 (from, to] 的状态分档。
 *
 * 「暴增/暴减」不是形容词，是陷阱判定的入口条件，所以必须有数。
 * ±7% 取自旧引擎实测的 90% 分位（18 个深度扫描币、17 个新极值样本），
 * ±1% 是中位数下方的噪音线。这两个数是量出来的，改之前先重新量。
 */
export function oiState(values: number[], from: number, to: number): OiState | null {
  const pct = pctChange(values, from, to);
  if (pct === null) return null;
  if (pct >= OI_SURGE_PCT) return "surge";
  if (pct >= OI_FLAT_PCT) return "up";
  if (pct <= -OI_SURGE_PCT) return "plunge";
  if (pct <= -OI_FLAT_PCT) return "down";
  return "flat";
}

export interface Sweep {
  /** 被扫的那条结构位（SSL 或 BSL）的价格 */
  level: number;
  /** 扫掉并收回的那根 K 线下标 */
  at: number;
}

/**
 * 扫单边流动性（SSL/BSL）并收回。
 *
 * 规格的三条要求缺一不可：
 *   ① 创出新极值——价格的最低/最高要越过那条结构位
 *   ② 收回来——**收盘价**要回到结构位另一侧
 *   ③ 有影线——①和②同时成立时影线自然存在
 *
 * 「仅实体跌破未收回 → 不是 sweep，场景不成立」就是第 ② 条：用收盘价
 * 而不是收盘±任意容差。这跟点火那边的口径是同一个道理——判「有没有站住」
 * 用收盘，判「有没有被打到」用极值。
 *
 * 结构位取**最近一个已确认的反向摆动点**：低点侧取上一个 swing low，
 * 高点侧取上一个 swing high。规格说的「前低/双底/等长低点」在这套
 * 数据粒度下都会落在同一个已确认摆动点上，不另做形态识别——多做一层
 * 形态匹配只会引入一堆没有实测支撑的阈值。
 */
export function findSweep(
  bars: CoinGlassPriceBar[],
  side: "low" | "high",
  lookback: number,
  n: number = PIVOT_N
): Sweep | null {
  const values = side === "low" ? lows(bars) : highs(bars);
  const pivots = findPivots(values, n, side);
  if (pivots.length === 0) return null;

  const last = bars.length - 1;
  const from = Math.max(0, last - lookback + 1);

  // 从最近往回找：第一根「越过结构位又收回来」的 K 线就是这次 sweep。
  for (let i = last; i >= from; i--) {
    // 结构位必须成形于这根之前，否则就成了拿未来的信息判过去。
    const levelIdx = [...pivots].reverse().find((p) => p < i - n);
    if (levelIdx === undefined) continue;
    const level = values[levelIdx];
    const wick = side === "low" ? parseFloat(bars[i].low) : parseFloat(bars[i].high);
    const close = parseFloat(bars[i].close);
    if (!Number.isFinite(level) || !Number.isFinite(wick) || !Number.isFinite(close)) continue;

    const pierced = side === "low" ? wick < level : wick > level;
    const reclaimed = side === "low" ? close > level : close < level;
    if (pierced && reclaimed) return { level, at: i };
  }
  return null;
}
