import type { CoinGlassTakerBar, CoinGlassPriceBar } from "@/lib/coinglass/types";
import { toFiniteNumber } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";
import { priceChangeOverBars } from "./oi";

/** 回归窗口：12 根 30 分钟 = 6 小时 */
export const CVD_WINDOW_BARS = 12;

/** 背离分打满所需的价格逆行幅度，% */
export const CVD_DIVERGENCE_FULL_PCT = 3;

/**
 * 「净买入 ÷ 同期总成交额」这个比值达到多少算满格。取实测分布的 99% 分位：
 * 中位数量级的资金流拿到约 6 分，95% 分位约 8 分，满分留给真正异常的情况。
 *
 * 原本直接把比值当 [-1,1] 用（等价于饱和点 = 1.0），后果是满分 20 的方向分
 * 只在 9.7~10.3 之间摆动——量程用掉不到 3%，整个 CVD 因子等于常数。
 * 所以必须有这个饱和点；它定在哪则要靠量。
 *
 * **量的时候有个坑，踩过一次：样本太薄会系统性低估。**
 * 第一次标定用的是 14 币 × 48 根 = 518 个窗口的单日快照，量出 99% 分位 0.153，
 * 于是定了 0.15。换成 7 天样本重量，两组各 14 币 × 336 根 = 4550 个窗口的
 * 独立样本给出 99% 分位 0.302 和 0.347——真实分布宽了一倍多，0.15 实际落在
 * 93~95% 分位，有 6.7~9.8% 的窗口顶在满分，量程上半段被压平。
 * 现在取两组的中间值 0.32。
 *
 * 顺带排除过一个误判：这次重标定和「CVD 数据源从 Binance 单家换成四家聚合」
 * 是同一次改动，容易以为是换源导致分布变了。实测不是——同样 13 个币、同样
 * 336 根，Binance 单家与四家聚合的分布几乎重合（中位 0.0594 vs 0.0563、
 * 99% 分位 0.3067 vs 0.3018）。是原来那次测量太薄，跟数据源无关。
 *
 * 重量的工具是 scripts/screener-calibrate.mjs（它测的是 cvdRawRatio，
 * 拿 cvdNorm 反推是行不通的，见那个函数的注释）。dryrun 每轮打印的分数分布
 * 是哨兵：如果哪天发现一半的币都顶在满分，就是该重新跑标定了。
 */
export const CVD_SATURATION = 0.32;

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
  const raw = cvdRawRatio(bars, window);
  if (raw === null) return null;
  // 先算出「净买入占同期总成交额的比例」，再除以饱和点映射到 [-1,1]。
  // 少了除以 CVD_SATURATION 这一步，真实数据只会落在 ±0.3 以内，
  // 整个因子等于常数 —— 见 CVD_SATURATION 的注释里那组实测分布。
  return clamp(raw / CVD_SATURATION, -1, 1);
}

/**
 * cvdNorm 的原始比值——**没有**除以饱和点、**没有**截断。
 *
 * 单独导出是为了标定：scripts/screener-calibrate.mjs 要测量的正是这个量的
 * 真实分布，好反推饱和点该定在哪。拿 cvdNorm 的输出去反推是行不通的，
 * 它已经被除过又被 clamp 过，99% 分位恒等于 1，乘回饱和点必然得到原值——
 * 那是个永远说「仍然合适」的自证检查。这个函数存在的唯一理由就是把那条
 * 反推路径变成真的。
 */
export function cvdRawRatio(bars: CoinGlassTakerBar[], window: number): number | null {
  if (bars.length < window) return null;

  const slice = bars.slice(-window);
  const cvd: number[] = [];
  let running = 0;
  let gross = 0;

  for (const b of slice) {
    const buy = toFiniteNumber(b.aggregated_buy_volume_usd);
    const sell = toFiniteNumber(b.aggregated_sell_volume_usd);
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
  return (slope * n) / gross;
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
