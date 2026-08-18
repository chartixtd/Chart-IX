import type { CoinGlassOiBar, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";
import { oiDivergence } from "./oi-divergence";

/** OI 变化小于这个百分比就认为没有方向，该窗口给中性分 */
export const OI_DEADZONE_PCT = 0.5;

/** 价格变化小于这个百分比同样认为没有方向 */
export const PRICE_DEADZONE_PCT = 0.3;

/** OI 变化达到这个百分比时象限分完全生效，不再向中性收缩 */
export const OI_FULL_STRENGTH_PCT = 2;

/**
 * 三个时间窗口及其权重。
 *
 * T20 之前这里的 key 指向持仓量快照的滚动窗口字段（open_interest_change_percent_30m
 * 等），现在数据源换成了序列（getOpenInterestHistory），三个窗口都改成用
 * priceChangeOverBars 在同一条 OI 收盘价序列上按 barsBack 现算——原理和价格侧
 * 完全一样，所以 key 字段没有存在的必要了，删掉。
 *
 * 刻意丢掉了端点原本提供的 5m 与 15m 粒度 —— 没有对应粒度的价格数据可以配对
 * （Startup 套餐 K 线最小 30m），单看 OI 变化无法判断象限。
 * 短窗口权重更高是因为这是个 15 分钟一扫的扫描器，要抓的是刚发生的资金动作。
 *
 * 换源顺带修掉了一处口径不一致：快照的变化率是「滚动实时」的（现在 vs 正好
 * 30/60/240 分钟前的任意时刻），而价格侧一直是「桶到桶」的（当前这根 K 线
 * vs 上一根）。以前一个滚动、一个分桶，两者的时间基准根本不是同一件事；
 * 现在统一成分桶、逐根对齐。代价是最短那个窗口会稍钝一点（实测 VELVET
 * 30m：滚动 2.14% → 分桶 0.30%），最长的窗口几乎不受影响（4h：30.62% → 29.20%）。
 */
export const OI_WINDOWS = [
  { barsBack: 1, weight: 0.4 },
  { barsBack: 2, weight: 0.35 },
  { barsBack: 8, weight: 0.25 },
] as const;

/**
 * 用收盘价算「barsBack 根之前到现在」的涨跌百分比。K 线不够长返回 null。
 *
 * 参数类型故意只要求 `{ close: string }`，不是具体的 CoinGlassPriceBar——
 * 这样同一个函数既能喂价格序列也能喂 OI 序列（两者形状一样，都是 OHLC
 * 字符串），不用为 OI 侧的窗口变化率再写一份几乎相同的函数。cvd.ts 也在用
 * 这个函数（唯一允许的跨因子依赖），把参数类型收窄成结构类型不影响它——
 * CoinGlassPriceBar 本身就满足 `{ close: string }`。
 */
export function priceChangeOverBars(
  bars: Array<{ close: string }>,
  barsBack: number
): number | null {
  if (bars.length <= barsBack) return null;
  const now = parseFloat(bars[bars.length - 1].close);
  const then = parseFloat(bars[bars.length - 1 - barsBack].close);
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return null;
  return ((now - then) / then) * 100;
}

/**
 * 四象限：
 *
 *   OI↑ 价↑  新多头进场，涨势有新钱   → 做多 100 / 做空 0
 *   OI↑ 价↓  新空头进场               → 做多 0   / 做空 100
 *   OI↓ 价↑  空头回补，涨得没新钱     → 做多 40  / 做空 30
 *   OI↓ 价↓  多头平仓离场             → 做多 30  / 做空 40
 *
 * 后两个象限两边都只给中低分是刻意的：减仓行情说明这一波没有新资金，
 * 无论往哪个方向做都缺乏推动力，不该因为「价格在涨」就奖励做多。
 */
export function quadrantScore(
  oiPct: number,
  pricePct: number,
  direction: Direction
): number {
  if (!Number.isFinite(oiPct) || !Number.isFinite(pricePct)) return 50;
  if (Math.abs(oiPct) < OI_DEADZONE_PCT) return 50;
  if (Math.abs(pricePct) < PRICE_DEADZONE_PCT) return 50;

  const oiUp = oiPct > 0;
  const priceUp = pricePct > 0;

  let raw: number;
  if (oiUp && priceUp) raw = direction === "long" ? 100 : 0;
  else if (oiUp && !priceUp) raw = direction === "long" ? 0 : 100;
  else if (!oiUp && priceUp) raw = direction === "long" ? 40 : 30;
  else raw = direction === "long" ? 30 : 40;

  // 变化越小越靠近中性：0.5% 的 OI 变动和 5% 的 OI 变动不该给同一个象限分
  const strength = Math.min(1, Math.abs(oiPct) / OI_FULL_STRENGTH_PCT);
  return 50 + (raw - 50) * strength;
}

/**
 * 背离最多能在象限的 0–100 分上加减多少。取 20 = 最多影响 6/30（20% × 30）的因子分。
 *
 * 为什么是象限之上的修正项而不是替换掉象限：象限没有参数、样本厚（三个窗口
 * 加权），是四个因子里最健康的一个（各币分值散布在 4–30 分）——这次改动的
 * 第一原则是不能把它弄坏。背离引入了摆动点识别的一整套阈值（PIVOT_N /
 * PRICE_EXTREME_MIN_PCT / OI_DIFF_MIN_PCT / OI_DIFF_FULL_PCT），这些阈值在
 * 真实回测之前没法判断调得对不对。把象限的基础分完整保留、只让背离在结构上
 * 确实出现时加减几分，是为了万一背离的参数拍砸了，不会把当前唯一健康的
 * 因子一起废掉——最坏情况下背离只是给基础分加了一点噪音，而不是让整个
 * OI 因子失真。
 */
export const OI_DIVERGENCE_MAX_ADJUST = 20;

/**
 * 序列长度为 0（上游请求失败或整段拿不到）给中性 15（满分一半）。OI 是
 * 「当前杠杆水位在怎么变」的状态型因子，请求失败不等于杠杆没在动 ——
 * 给 0 会让一次上游抖动直接把这个币踢出榜单。这与 Sweep 事件型因子的
 * 缺失语义相反。序列长度不为 0 但不够算某个窗口时，该窗口在下面的循环里
 * 单独跳过、不计权重，不在这里一次性拦掉。
 */
export function oiScore(
  oiBars: CoinGlassOiBar[],
  priceBars: CoinGlassPriceBar[],
  direction: Direction
): number {
  let weighted = 0;
  let usedWeight = 0;

  for (const w of OI_WINDOWS) {
    const oiPct = priceChangeOverBars(oiBars, w.barsBack);
    const pricePct = priceChangeOverBars(priceBars, w.barsBack);
    // 任一序列窗口取不到就跳过这个窗口，而不是当成 0 —— 当成 0 会落进死区
    // 拿中性 50，等于用一个假数据稀释掉另外两个真窗口。
    if (oiPct === null || pricePct === null) continue;
    weighted += quadrantScore(oiPct, pricePct, direction) * w.weight;
    usedWeight += w.weight;
  }

  if (usedWeight === 0) return FACTOR_MAX.oi / 2;

  const base = weighted / usedWeight; // 0–100，象限基础分

  // 背离修正项：oiDivergence 自己会在长度不等、极值对不够、幅度没过门槛时
  // 返回 0（不调整），所以这里不需要额外判断数据够不够——0 调整量本身就是
  // 正确的「没有可用背离信号」的表达。
  const signed = oiDivergence(priceBars, oiBars);
  const directional = direction === "long" ? signed : -signed;
  const adjusted = Math.max(0, Math.min(100, base + directional * OI_DIVERGENCE_MAX_ADJUST));

  return Math.max(0, Math.min(FACTOR_MAX.oi, (adjusted / 100) * FACTOR_MAX.oi));
}
