import type { CoinGlassPriceBar, CoinGlassOiBar } from "@/lib/coinglass/types";

/** 摆动点识别的半窗宽度。7 天 336 根 30m 下平均出 21 个高点，确认滞后 2.5 小时。 */
export const PIVOT_N = 5;

/**
 * 两个极值之间价格至少要差这么多（%）才算「创了新极值」。
 * 实测数据里混着噪音级的「新极值」（`价+0.4% OI+15.7%`、`价-0.7% OI-1.2%` 这类），
 * 没有这道门槛，背离信号会被这类噪音刷满。
 */
export const PRICE_EXTREME_MIN_PCT = 1;

/** 两个极值之间持仓量至少要差这么多（%）才做背离判断 */
export const OI_DIFF_MIN_PCT = 2;

/** 持仓量差到这个百分比时背离强度打满 */
export const OI_DIFF_FULL_PCT = 10;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 已确认的摆动点下标。只扫 [n, len-n) 这个区间是这个函数的全部要点：
 * 最后 n 根之内的「疑似极值」随时会被新 K 线推翻，用了它信号就会 repaint
 * ——网页上刚显示背离、下一根 K 线又没了，这种事发生一次这套系统就没人信了。
 *
 * 判定用非严格比较（high 用 `values[j] > values[i]` 才算「更差」）：完全平坦的
 * 序列里，窗口内所有值相等，没有哪一个「更极端」，此时区间内每个下标都满足
 * 「没有比自己更极端的邻居」，会被整体判定为摆动点。这是刻意的定义，不是
 * bug——真正会把这类伪摆动点挡掉的是调用方 oiDivergence 里的
 * PRICE_EXTREME_MIN_PCT（相邻两个摆动点之间价格没有真实变化，过不了幅度门槛）。
 */
export function findPivots(values: number[], n: number, kind: "high" | "low"): number[] {
  const pivots: number[] = [];
  const len = values.length;
  if (len < 2 * n + 1) return pivots;

  for (let i = n; i < len - n; i++) {
    let isPivot = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      const worse = kind === "high" ? values[j] > values[i] : values[j] < values[i];
      if (worse) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push(i);
  }
  return pivots;
}

/**
 * 用「最后两个已确认摆动点」算出一侧（高点侧或低点侧）的信号。
 *
 * wantHigher=true 处理高点侧（要 curr > prev 才算创新高）；
 * wantHigher=false 处理低点侧（要 curr < prev 才算创新低）。
 * 两侧算法完全对称，只是「新极值」的方向相反，所以抽成一个函数、
 * 用 wantHigher 切换方向，而不是复制一份几乎一样的代码。
 */
function pivotPairSignal(
  pivots: number[],
  priceValues: number[],
  oiCloses: number[],
  wantHigher: boolean
): number {
  if (pivots.length < 2) return 0;
  const prevIdx = pivots[pivots.length - 2];
  const currIdx = pivots[pivots.length - 1];

  const prevPrice = priceValues[prevIdx];
  const currPrice = priceValues[currIdx];
  if (!Number.isFinite(prevPrice) || !Number.isFinite(currPrice) || prevPrice <= 0) return 0;

  // 统一成「相对上一个极值变多了多少个正数百分比」，高低两侧共用同一套门槛判断。
  const priceChangePct = wantHigher
    ? ((currPrice - prevPrice) / prevPrice) * 100
    : ((prevPrice - currPrice) / prevPrice) * 100;
  if (!Number.isFinite(priceChangePct) || priceChangePct < PRICE_EXTREME_MIN_PCT) return 0;

  const prevOi = oiCloses[prevIdx];
  const currOi = oiCloses[currIdx];
  if (!Number.isFinite(prevOi) || !Number.isFinite(currOi) || prevOi <= 0) return 0;

  const oiChangePct = ((currOi - prevOi) / prevOi) * 100;
  if (!Number.isFinite(oiChangePct) || Math.abs(oiChangePct) < OI_DIFF_MIN_PCT) return 0;

  const strength = Math.min(Math.abs(oiChangePct) / OI_DIFF_FULL_PCT, 1);
  const oiUp = oiChangePct > 0;

  if (wantHigher) {
    // 高点侧：价格创新高，但 OI 反而跟跌 = 这一波没有新钱接力 = 顶背离，偏空；
    // OI 跟涨 = 上涨有新钱确认，但「确认」只是确认，不如「背离」值钱，打五折。
    return oiUp ? strength * 0.5 : -strength;
  }
  // 低点侧：价格创新低，但 OI 反而跟跌 = 这一波没有新空头接力 = 底背离，偏多；
  // OI 跟涨 = 下跌有新空头确认，同样只打五折。
  return oiUp ? -strength * 0.5 : strength;
}

/**
 * 返回一个有符号的调整量，正数偏多、负数偏空，范围 [-1, 1]。
 * 0 表示没有可用的信号（极值对不够、幅度没过门槛）。
 *
 * 符号方向手工验算过（写在 T20 report 里）：价格创新高但 OI 更低 = 涨势没有
 * 新钱接力 = 偏空；价格创新低但 OI 更低 = 跌势没有新空头接力 = 偏多。这个
 * 函数只谈市场结构、不谈做多做空，方向号（direction）在 oi.ts 里应用。
 */
export function oiDivergence(priceBars: CoinGlassPriceBar[], oiBars: CoinGlassOiBar[]): number {
  // 长度不等时两条序列的下标不再对应同一时刻，硬按下标取值会取到完全不相干
  // 的两个时间点，而且不会报错、只会让信号悄悄全部算错——必须在这里直接
  // 放弃，不能往下走一步再说。
  if (priceBars.length !== oiBars.length) return 0;
  if (priceBars.length === 0) return 0;

  const highs = priceBars.map((b) => parseFloat(b.high));
  const lows = priceBars.map((b) => parseFloat(b.low));
  const oiCloses = oiBars.map((b) => parseFloat(b.close));

  // 用价格的 high 序列找摆动高点、low 序列找摆动低点，直接读同下标的 OI 收盘值——
  // 不在 OI 序列上单独找 pivot 再配对。三条序列（价格/主动买卖/OI）在 30m 粒度下
  // 逐根时间戳完全一致（已实测），所以同下标就是同一时刻；分别找 pivot 会陷入
  // 「OI 的高点比价格晚几根算不算同一个」这种没有标准答案的麻烦。
  const highPivots = findPivots(highs, PIVOT_N, "high");
  const lowPivots = findPivots(lows, PIVOT_N, "low");

  const highSignal = pivotPairSignal(highPivots, highs, oiCloses, true);
  const lowSignal = pivotPairSignal(lowPivots, lows, oiCloses, false);

  // 两侧都有信号时相加再夹到 [-1,1]：它们可能互相抵消，那正是「结构上没有
  // 明确方向」的正确表达，不是需要修的 bug。
  return clamp(highSignal + lowSignal, -1, 1);
}
