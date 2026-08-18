import type {
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassLiquidationBar,
  CoinGlassOiBar,
} from "@/lib/coinglass/types";
import { SERIES_LIMIT } from "@/lib/coinglass/price-history";
import type { Direction, FactorBreakdown } from "./types";
import { zoneScore } from "./factors/zone";
import { sweepScore } from "./factors/sweep";
import { oiScore } from "./factors/oi";
import { cvdScore } from "./factors/cvd";

export interface ScoreInputs {
  /** BingX 的成交价 */
  price: number;
  /** 7 天 30m K 线，同时喂 Zone / Sweep / OI / 振幅 */
  priceBars: CoinGlassPriceBar[];
  liquidation: CoinGlassLiquidationBar[];
  taker: CoinGlassTakerBar[];
  /**
   * 7 天 30m 持仓量序列（全交易所聚合），与 priceBars 逐根对齐——OI 因子的
   * 背离判断依赖「同下标 = 同时刻」，两条序列的粒度和长度必须一致。
   * 拿不到时传 []，不是 undefined：oiScore 对空数组走中性分支。
   */
  oiBars: CoinGlassOiBar[];
}

export function scoreDirection(inputs: ScoreInputs, direction: Direction): FactorBreakdown {
  return {
    zone: zoneScore(inputs.price, inputs.priceBars, direction),
    sweep: sweepScore(inputs.liquidation, inputs.priceBars, direction),
    oi: oiScore(inputs.oiBars, inputs.priceBars, direction),
    cvd: cvdScore(inputs.taker, inputs.priceBars, direction),
  };
}

function sum(f: FactorBreakdown): number {
  return f.zone + f.sweep + f.oi + f.cvd;
}

/**
 * 对每个币把 long 与 short 各算一遍，方向 = 总分高的那一边。
 *
 * 方向 pill 与 0–100 总分因此由同一次计算产出，不会出现「方向说 LONG
 * 但因子构成看着像 SHORT」的矛盾。平局时取 long 只是为了让结果稳定可复现，
 * 不含任何多头偏好——平局意味着两边一样没优势，总分本身也不会高。
 *
 * 取整只在最后做：四条曲线都有平台段，先取整会让排序被浮点末位而不是
 * 真实差异决定。
 */
export function pickDirection(inputs: ScoreInputs): {
  direction: Direction;
  total: number;
  factors: FactorBreakdown;
} {
  const long = scoreDirection(inputs, "long");
  const short = scoreDirection(inputs, "short");
  const longTotal = sum(long);
  const shortTotal = sum(short);

  const isLong = longTotal >= shortTotal;
  const factors = isLong ? long : short;

  // total 必须是「取整后四项之和」，不能是「未取整总和的取整」。
  // 两条取整路径各自舍入误差最坏累计到 2，会让 total 与 factors 四项之和
  // 相差超过 1，违反 types.ts 里 ScannerRow.total 的类型注释（「等于 factors
  // 四项之和（已取整）」——精确相等）。方向判定（isLong）仍然用未取整的
  // longTotal/shortTotal 比较，这里不动：「取整只在最后做」这条原则针对
  // 的是排序与方向选择，不是总分的自洽性。
  const rounded: FactorBreakdown = {
    zone: Math.round(factors.zone),
    sweep: Math.round(factors.sweep),
    oi: Math.round(factors.oi),
    cvd: Math.round(factors.cvd),
  };

  return {
    direction: isLong ? "long" : "short",
    total: rounded.zone + rounded.sweep + rounded.oi + rounded.cvd,
    factors: rounded,
  };
}

/**
 * 真 24h 振幅，用近 48 根 30m K 线算。
 *
 * 不用 BingX ticker 的 highPrice/lowPrice：那一份只服务粗筛（粗筛发生在
 * 拉 K 线之前，没得选），展示与滑块过滤都该用这一份。两者会有出入，
 * 出入本身是正常的——BingX 单交易所 vs CoinGlass 选定交易所。
 */
export function amplitudeFromBars(bars: CoinGlassPriceBar[]): number | null {
  const slice = bars.slice(-SERIES_LIMIT);
  if (slice.length === 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (const b of slice) {
    const h = parseFloat(b.high);
    const l = parseFloat(b.low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;
  return ((high - low) / low) * 100;
}
