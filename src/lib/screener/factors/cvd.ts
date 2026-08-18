import type { CoinGlassTakerBar, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";
import { priceChangeOverBars } from "./oi";

/** 回归窗口：12 根 30 分钟 = 6 小时 */
export const CVD_WINDOW_BARS = 12;

/** 背离分打满所需的价格逆行幅度，% */
export const CVD_DIVERGENCE_FULL_PCT = 3;

/** 方向分与背离分各占满分的一半 */
const TREND_MAX = FACTOR_MAX.cvd / 2;
const DIVERGENCE_MAX = FACTOR_MAX.cvd / 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 最近 window 根 CVD 的拟合净位移 ÷ 同期换手总量。
 *
 * 分子取「线性回归斜率 × 根数」而不是「末值 − 首值」：末值−首值只看两个端点，
 * 一根异常的收尾 K 线就能把整段趋势的符号翻过来；回归吃进全部样本。
 *
 * 分母是同期买卖成交额之和，相除得到无量纲的「净买入占总成交的比例」，
 * 天然落在 [-1, 1] 且不受币的绝对体量影响 —— 这样一个日成交 500 万的小币
 * 和一个 5 亿的大币可以用同一条曲线打分。
 */
export function cvdNorm(bars: CoinGlassTakerBar[], window: number): number | null {
  if (bars.length < window) return null;

  const slice = bars.slice(-window);
  const cvd: number[] = [];
  let running = 0;
  let gross = 0;

  for (const b of slice) {
    const buy = parseFloat(b.taker_buy_volume_usd);
    const sell = parseFloat(b.taker_sell_volume_usd);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    running += buy - sell;
    gross += buy + sell;
    cvd.push(running);
  }
  if (gross <= 0) return null;

  // 最小二乘斜率。x 取 0..n-1，均值与分母都是常量，直接展开算。
  const n = cvd.length;
  const meanX = (n - 1) / 2;
  const meanY = cvd.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (cvd[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return null;

  const slope = num / den; // USD / 根
  return clamp((slope * n) / gross, -1, 1);
}

/**
 * 背离比同向更值钱，所以单独占一半权重。
 *
 * 同向时给 0 而不是负分：同向的价值已经在方向分里表达过一次了，
 * 再给一次是重复计分；给负分则会把「趋势健康」惩罚成「不如没有信号」。
 */
function divergenceScore(norm: number, pricePct: number, direction: Direction): number {
  const wantPriceDown = direction === "long";
  const priceAgainst = wantPriceDown ? pricePct < 0 : pricePct > 0;
  const flowWith = wantPriceDown ? norm > 0 : norm < 0;
  if (!priceAgainst || !flowWith) return 0;

  const priceLeg = Math.min(1, Math.abs(pricePct) / CVD_DIVERGENCE_FULL_PCT);
  const flowLeg = Math.min(1, Math.abs(norm));
  return DIVERGENCE_MAX * priceLeg * flowLeg;
}

/**
 * 数据缺失时方向分给中性 5、背离分给 0（合计 5）。
 * CVD 的方向是状态型的（资金现在往哪边打），拿不到数据不代表方向差；
 * 但背离是事件型的（此刻正在发生一件反常的事），没证据就是没发生。
 * 一个因子内部两半用不同的缺失语义是刻意的，不要统一。
 */
export function cvdScore(
  taker: CoinGlassTakerBar[],
  price: CoinGlassPriceBar[],
  direction: Direction
): number {
  const norm = cvdNorm(taker, CVD_WINDOW_BARS);
  const pricePct = priceChangeOverBars(price, CVD_WINDOW_BARS);
  if (norm === null || pricePct === null) return TREND_MAX / 2;

  const signed = direction === "long" ? norm : -norm;
  const trend = ((signed + 1) / 2) * TREND_MAX;

  return clamp(trend + divergenceScore(norm, pricePct, direction), 0, FACTOR_MAX.cvd);
}
