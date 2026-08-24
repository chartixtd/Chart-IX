import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

/**
 * 点火：价格刚刚突破最近 N 根 K 线的区间。
 *
 * **这是整套系统里唯一一个没有确认延迟的触发条件。** 六场景锚在已确认的
 * 摆动点上（PIVOT_N=5），要等 5 根 30 分钟 K 线走完才算数——也就是结构
 * 真的翻掉之后，还要过 2.5 小时才判得出来。等到那时候，「刚启动」早就
 * 不成立了。点火只看当前这根收盘价有没有越过前 N 根的高低点，
 * **当根收盘即可判定，延迟最多 30 分钟**。
 *
 * 实测（50 个币、528 个不重叠时点、84 次点火，前瞻 12 小时）：
 *   · 只要点火，延续中位 6.1% / 回吐中位 1.3%，延续占比 82%
 *   · 再叠加「24h 振幅最低 1/3」的选币，延续占比升到 85%、胜率 83%
 *   · 反过来叠加「24h 振幅最高 1/3」，延续占比塌到 21%——跟对方向也倒亏
 *
 * 也就是说：**点火本身是信号，选币负责别把它毁掉**。
 */

/**
 * 回看多少根。12 根 30 分钟 = 6 小时。
 *
 * 窗口太短（比如 2 小时）会把日内噪音当成突破，太长（24 小时）又会等到
 * 行情走完一大截才算「突破」。6 小时是实测那一版用的窗口，也是这份数据
 * 支持的唯一一个——换窗口要重新测，别凭感觉调。
 */
export const IGNITION_LOOKBACK_BARS = 12;

export interface Ignition {
  /** 突破方向：向上突破前高 / 向下跌破前低 */
  direction: "up" | "down";
  /** 被突破的那个区间边界价——它天然就是这次点火的失效位 */
  level: number;
  /** 突破幅度，% —— 刚越过线和暴力拉穿是两回事 */
  distancePct: number;
}

/**
 * 检测最后一根 K 线有没有点火。
 *
 * 用**收盘价**判突破而不是最高/最低价：影线穿一下又收回来不算启动，
 * 那正是最典型的假突破。这跟失效判定刻意相反——失效用区间极值（插针
 * 也算数，止损被扫了就是被扫了），点火用收盘价（要的是「站上去了」）。
 * 两处口径不同是故意的，因为它们要防的是两种相反的错误：失效怕漏判，
 * 点火怕误判。
 *
 * 比较区间**不含当前这根**（`[len-1-N, len-1)`）：拿当前根跟包含自己的
 * 区间比，永远不可能突破。
 */
export function detectIgnition(
  bars: CoinGlassPriceBar[],
  lookback: number = IGNITION_LOOKBACK_BARS
): Ignition | null {
  if (bars.length < lookback + 1) return null;

  const last = bars[bars.length - 1];
  const close = parseFloat(last.close);
  if (!Number.isFinite(close) || close <= 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (let i = bars.length - 1 - lookback; i < bars.length - 1; i++) {
    const h = parseFloat(bars[i].high);
    const l = parseFloat(bars[i].low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;

  if (close > high) {
    return { direction: "up", level: high, distancePct: ((close - high) / high) * 100 };
  }
  if (close < low) {
    return { direction: "down", level: low, distancePct: ((low - close) / low) * 100 };
  }
  return null;
}
