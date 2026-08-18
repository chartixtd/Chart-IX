import type { CoinGlassOpenInterestRow, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";

/** OI 变化小于这个百分比就认为没有方向，该窗口给中性分 */
export const OI_DEADZONE_PCT = 0.5;

/** 价格变化小于这个百分比同样认为没有方向 */
export const PRICE_DEADZONE_PCT = 0.3;

/** OI 变化达到这个百分比时象限分完全生效，不再向中性收缩 */
export const OI_FULL_STRENGTH_PCT = 2;

/**
 * 三个时间窗口及其权重。
 *
 * 刻意丢掉了端点提供的 5m 与 15m —— 没有对应粒度的价格数据可以配对
 * （Startup 套餐 K 线最小 30m），单看 OI 变化无法判断象限。
 * 短窗口权重更高是因为这是个 15 分钟一扫的扫描器，要抓的是刚发生的资金动作。
 */
export const OI_WINDOWS = [
  { key: "open_interest_change_percent_30m", barsBack: 1, weight: 0.4 },
  { key: "open_interest_change_percent_1h", barsBack: 2, weight: 0.35 },
  { key: "open_interest_change_percent_4h", barsBack: 8, weight: 0.25 },
] as const;

/** 用收盘价算「barsBack 根之前到现在」的涨跌百分比。K 线不够长返回 null。 */
export function priceChangeOverBars(
  bars: CoinGlassPriceBar[],
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
 * 拿不到聚合行给中性 15（满分一半）。OI 是「当前杠杆水位在怎么变」的状态型因子，
 * 请求失败不等于杠杆没在动 —— 给 0 会让一次上游抖动直接把这个币踢出榜单。
 * 这与 Sweep 事件型因子的缺失语义相反。
 */
export function oiScore(
  oi: CoinGlassOpenInterestRow | undefined,
  bars: CoinGlassPriceBar[],
  direction: Direction
): number {
  if (!oi) return FACTOR_MAX.oi / 2;

  let weighted = 0;
  let usedWeight = 0;

  for (const w of OI_WINDOWS) {
    const oiPct = oi[w.key];
    const pricePct = priceChangeOverBars(bars, w.barsBack);
    // 价格窗口取不到就跳过这个窗口，而不是当成 0 —— 当成 0 会落进价格死区
    // 拿中性 50，等于用一个假数据稀释掉另外两个真窗口。
    if (typeof oiPct !== "number" || pricePct === null) continue;
    weighted += quadrantScore(oiPct, pricePct, direction) * w.weight;
    usedWeight += w.weight;
  }

  if (usedWeight === 0) return FACTOR_MAX.oi / 2;

  const normalized = weighted / usedWeight; // 0–100
  return Math.max(0, Math.min(FACTOR_MAX.oi, (normalized / 100) * FACTOR_MAX.oi));
}
