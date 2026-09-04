import { describe, it, expect } from "vitest";
import {
  findPivots,
  oiDivergence,
  PIVOT_N,
  PRICE_EXTREME_MIN_PCT,
  OI_DIFF_MIN_PCT,
} from "./oi-divergence";
import type { CoinGlassPriceBar, CoinGlassOiBar } from "@/lib/coinglass/types";

describe("findPivots", () => {
  it("不返回最后 n 根内的下标——这是防 repaint 的核心", () => {
    // 全局最高点在最后 3 根以内（index 9，n=3，有效区间是 [3,7)）。
    // 它是真正的最高值，但因为随时会被下一根 K 线推翻，绝不能被当成已确认摆动点。
    const values = [1, 2, 3, 4, 3, 2, 1, 2, 3, 9];
    const pivots = findPivots(values, 3, "high");
    for (const idx of pivots) {
      expect(idx).toBeGreaterThanOrEqual(3);
      expect(idx).toBeLessThan(values.length - 3);
    }
    expect(pivots).not.toContain(9);
    // index 3（值 4）在窗口 [0,6] 内确实是局部最高点，应该被识别为已确认摆动点。
    expect(pivots).toContain(3);
  });

  it("数据不足 2n+1 根时返回空数组", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // 9 根，n=5 需要至少 11 根
    expect(findPivots(values, 5, "high")).toEqual([]);
  });

  it("平坦序列：窗口内所有值相等，落在有效区间内的下标都算摆动点", () => {
    // 11 根全相等，n=5 时有效区间恰好只有 index 5 一个下标。
    const values = new Array(11).fill(5);
    expect(findPivots(values, 5, "high")).toEqual([5]);
  });

  it('低点识别（kind="low"）与高点对称', () => {
    const values = [9, 8, 7, 6, 5, 6, 7, 8, 9, 1, 9, 8, 7];
    // 有效区间 [3,10)（len=13, n=3），全局最低点在 index 9（值 1），
    // 该点确实落在有效区间内且是真正的局部最低点，应该被识别为已确认摆动点。
    const pivots = findPivots(values, 3, "low");
    expect(pivots).toContain(9);
  });
});

/**
 * 构造两峰/两谷价格与 OI 序列，用来测试 oiDivergence。
 *
 * 用显式下标赋值（而不是数字字面量数组）来搭，避免像早期草稿那样数错元素
 * 个数、把峰值搭到了错误的下标上——那种错法测试还是会通过，但通过的理由
 * 是错的，等于没测。
 *
 * 结构固定：两个摆动点分别在 ANCHOR_PREV=5、ANCHOR_CURR=17，中间用单调
 * 斜坡连接、两端各留 PIVOT_N=5 根做窗口，第二个摆动点之后再留 5 根
 * 让它满足「已确认」（PIVOT_N=5，有效区间是 [5, len-5)=[5,18)，17 在区间内）。
 */
const ANCHOR_PREV = 5;
const ANCHOR_CURR = 17;
const SERIES_LEN = 23;

function buildTwoExtremeSeries(extreme1: number, extreme2: number): number[] {
  const values = new Array(SERIES_LEN).fill(0);
  const ramp1 = [90, 92, 94, 96, 98].map((v) => (v / 100) * extreme1);
  const ramp2 = [0.9, 0.93, 0.95, 0.97, 0.99].map((v) => v * extreme2);

  for (let i = 0; i < 5; i++) values[i] = ramp1[i]; // 0-4，爬向第一个极值
  values[ANCHOR_PREV] = extreme1; // 5
  for (let i = 0; i < 5; i++) values[ANCHOR_PREV + 1 + i] = ramp1[4 - i]; // 6-10，镜像下坡
  values[11] = Math.min(ramp1[0], ramp2[0]) * 0.9; // 11，两段之间的过渡谷/峰，务必比两侧都更极端一档

  for (let i = 0; i < 5; i++) values[12 + i] = ramp2[i]; // 12-16，爬向第二个极值
  values[ANCHOR_CURR] = extreme2; // 17
  for (let i = 0; i < 5; i++) values[ANCHOR_CURR + 1 + i] = ramp2[4 - i]; // 18-22，镜像下坡

  return values;
}

/** 两峰结构：index 5 与 17 是局部最高点，17 处的值比 5 处高 pctHigher% */
function twoPeakHighs(pctHigher: number): number[] {
  const peak1 = 100;
  const peak2 = peak1 * (1 + pctHigher / 100);
  return buildTwoExtremeSeries(peak1, peak2);
}

/** 两谷结构：index 5 与 17 是局部最低点，17 处的值比 5 处低 pctLower% */
function twoTroughLows(pctLower: number): number[] {
  const trough1 = 100;
  const trough2 = trough1 * (1 - pctLower / 100);
  // buildTwoExtremeSeries 搭的是「两端低、中心高」的峰形；谷形只需要把
  // 符号倒过来复用同一套斜坡结构（峰变谷，两端从低变高）。
  const peaks = buildTwoExtremeSeries(200 - trough1, 200 - trough2);
  return peaks.map((v) => 200 - v);
}

/** 常数数组：任意两个已确认摆动点之间价格变化恒为 0，过不了 PRICE_EXTREME_MIN_PCT 门槛 */
function flat(value: number): number[] {
  return new Array(SERIES_LEN).fill(value);
}

function priceBarsFrom(highs: number[], lows: number[]): CoinGlassPriceBar[] {
  return highs.map((h, i) => ({
    time: i * 1_800_000,
    open: String(h),
    high: String(h),
    low: String(lows[i]),
    close: String(h),
    volume_usd: "1000",
  }));
}

/**
 * 只在 index 5 与 17 放有意义的 OI 收盘值，其余下标不参与计算，填常数即可。
 *
 * open/low 用字符串、high/close 用 number——贴合 T20 review F1 实测的真实
 * 响应形状（同一根 K 线里字段类型是混的：
 * `{"open":"45714242","high":45740423.0381,"low":"45714242","close":45740423.0381}`）。
 * oiDivergence 只读 close 字段，这里把 close 定成 number 就是在验证
 * `toFiniteNumber` 的 number 分支在真实调用路径上是通的，不是只在
 * types.test.ts 里单独测过、集成路径上从没跑过。
 */
function oiBarsWithAnchors(len: number, valAtPrev: number, valAtCurr: number): CoinGlassOiBar[] {
  return Array.from({ length: len }, (_, i) => {
    let c = 100;
    if (i === ANCHOR_PREV) c = valAtPrev;
    else if (i === ANCHOR_CURR) c = valAtCurr;
    return { time: i * 1_800_000, open: String(c), high: c, low: String(c), close: c };
  });
}

describe("twoPeakHighs / twoTroughLows 夹具自检", () => {
  // 这两个夹具的正确性是下面所有 oiDivergence 用例的前提；先直接验一遍
  // findPivots 真的在 ANCHOR_PREV/ANCHOR_CURR 找到点，而不是搭错了地方。
  it("twoPeakHighs 的两个摆动高点恰好落在 ANCHOR_PREV 与 ANCHOR_CURR", () => {
    expect(findPivots(twoPeakHighs(5), PIVOT_N, "high")).toEqual([ANCHOR_PREV, ANCHOR_CURR]);
  });

  it("twoTroughLows 的两个摆动低点恰好落在 ANCHOR_PREV 与 ANCHOR_CURR", () => {
    expect(findPivots(twoTroughLows(5), PIVOT_N, "low")).toEqual([ANCHOR_PREV, ANCHOR_CURR]);
  });
});

describe("oiDivergence", () => {
  it("顶背离：价格创新高但 OI 更低 → 偏空（负数）", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 80); // -20%，超过 OI_DIFF_FULL_PCT，强度打满
    expect(oiDivergence(priceBars, oiBars)).toBeCloseTo(-1);
  });

  it("上涨延续：价格创新高且 OI 也更高 → 偏多，但只给一半强度", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 120); // +20%，强度打满，延续打五折
    expect(oiDivergence(priceBars, oiBars)).toBeCloseTo(0.5);
  });

  it("底背离：价格创新低但 OI 更低 → 偏多（正数）", () => {
    const priceBars = priceBarsFrom(flat(1000), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 80); // -20%
    expect(oiDivergence(priceBars, oiBars)).toBeCloseTo(1);
  });

  it("下跌延续：价格创新低且 OI 也更高 → 偏空，但只给一半强度", () => {
    const priceBars = priceBarsFrom(flat(1000), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 120); // +20%
    expect(oiDivergence(priceBars, oiBars)).toBeCloseTo(-0.5);
  });

  it("价格幅度没过 PRICE_EXTREME_MIN_PCT 时返回 0", () => {
    // 新高只比上一个高点高 0.3%，低于 1% 的门槛，即使 OI 变化很大也不该出信号。
    expect(PRICE_EXTREME_MIN_PCT).toBe(1); // 门槛值没被改动，测试假设才成立
    const priceBars = priceBarsFrom(twoPeakHighs(0.3), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 80);
    expect(oiDivergence(priceBars, oiBars)).toBe(0);
  });

  it("OI 幅度没过 OI_DIFF_MIN_PCT 时返回 0", () => {
    expect(OI_DIFF_MIN_PCT).toBe(2); // 门槛值没被改动，测试假设才成立
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 99); // -1%，低于 2% 门槛
    expect(oiDivergence(priceBars, oiBars)).toBe(0);
  });

  it("长度不等时直接返回 0，不按下标硬取", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN - 1, 100, 80); // 少一根，下标不再对应同一时刻
    expect(oiDivergence(priceBars, oiBars)).toBe(0);
  });

  it("已确认摆动点不足两个时返回 0", () => {
    // 高点侧：一段单调上升，任何窗口里后面总有更高的值，找不出一个局部最高点，
    // findPivots 返回空数组。低点侧：给平坦序列，虽然会命中「平坦序列都算摆动点」
    // 那条规则，但相邻两个摆动点之间价格变化是 0，一样过不了 PRICE_EXTREME_MIN_PCT。
    // 两条路径殊途同归，最终都应该是 0。
    const shortHighs = Array.from({ length: 12 }, (_, i) => 100 + i);
    expect(findPivots(shortHighs, PIVOT_N, "high")).toEqual([]);
    const shortLows = new Array(12).fill(1);
    const priceBars = priceBarsFrom(shortHighs, shortLows);
    const oiBars = oiBarsWithAnchors(12, 100, 80);
    expect(oiDivergence(priceBars, oiBars)).toBe(0);
  });

  it("高点侧与低点侧信号互相抵消：共用同一对 OI 读数时，顶背离与底背离数值相等符号相反", () => {
    // twoPeakHighs 与 twoTroughLows 的摆动点都固定在 (ANCHOR_PREV, ANCHOR_CURR)，
    // 两侧因此共用同一对 OI 读数：OI 下跌 20% 时，高点侧是顶背离（-1，偏空），
    // 低点侧同时是底背离（+1，偏多）——两者互相抵消，总和是 0。这个用例只
    // 验证「抵消」这个行为分支，不代表 clamp 被触发过（-1 与 +1 相加恰好落在
    // [-1,1] 内部，根本不需要夹）；clamp 真正被逼到边界的场景见下一条用例。
    const priceBars = priceBarsFrom(twoPeakHighs(5), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 80);
    expect(oiDivergence(priceBars, oiBars)).toBeCloseTo(0);
  });

  it("高点侧与低点侧信号同号叠加，和超过 1 时真的被 clamp 到边界", () => {
    // 上一条用例里两侧共用同一对 OI 读数（都在 index 5/17），数学上只能凑出
    // 恰好互相抵消的 0，从没把 clamp 逼到边界过。这里把低点侧的摆动点位置
    // 错开一格（6、18），OI 在这两个下标上与高点侧的 5、17 各自独立，才能
    // 构造出「两侧同号、和超过 1」的场景，真正触发 clamp（而不是巧合对冲）。
    const LOW_PREV = 6;
    const LOW_CURR = 18;
    const LEN = 24;

    // 高点结构复用 twoPeakHighs（峰在 5、17），补一根到 24 根——补的那一根
    // （index 23）落在有效摆动点区间 [5, 19) 之外（len - PIVOT_N = 19），
    // 不会长出新摆动点，下面的自检断言会确认这一点。
    const highs = [...twoPeakHighs(5), twoPeakHighs(5)[SERIES_LEN - 1]];

    // 低点结构：谷在 6、18，两端斜坡跟 buildTwoExtremeSeries 同一个套路，
    // 只是下标整体后移一格，谷 2 比谷 1 低 5%。
    const lows = new Array(LEN).fill(0);
    const lowRamp1 = [112, 110, 108, 106, 104, 102];
    for (let i = 0; i < lowRamp1.length; i++) lows[i] = lowRamp1[i]; // 0-5，爬向谷 1
    lows[LOW_PREV] = 100; // 6，谷 1
    const lowMirror1 = [102, 104, 106, 108, 110];
    for (let i = 0; i < lowMirror1.length; i++) lows[LOW_PREV + 1 + i] = lowMirror1[i]; // 7-11，镜像回升
    lows[12] = 110; // 过渡
    const lowRamp2 = [105, 103, 101, 99, 97];
    for (let i = 0; i < lowRamp2.length; i++) lows[13 + i] = lowRamp2[i]; // 13-17，爬向谷 2
    lows[LOW_CURR] = 95; // 18，谷 2，比谷 1 低 5%
    const lowMirror2 = [97, 99, 101, 103, 105];
    for (let i = 0; i < lowMirror2.length; i++) lows[LOW_CURR + 1 + i] = lowMirror2[i]; // 19-23，镜像回升

    // 先自检：确认摆动点真的落在预期下标上，不是又数错了地方
    // （早期草稿犯过这个错，第 17 峰值被搭到了 index16）。
    expect(findPivots(highs, PIVOT_N, "high")).toEqual([ANCHOR_PREV, ANCHOR_CURR]);
    expect(findPivots(lows, PIVOT_N, "low")).toEqual([LOW_PREV, LOW_CURR]);

    const priceBars = priceBarsFrom(highs, lows);

    // 高点侧：OI 在 (5,17) 上 -20% → 顶背离，偏空，打满 -1。
    // 低点侧：OI 在 (6,18) 上 +20% → 下跌延续，偏空打五折，-0.5。
    // 两者同号相加 = -1.5，超出 [-1,1]，必须被 clamp 到 -1——这才是
    // 真正的边界触发，不是巧合的互相抵消。
    const oiBars: CoinGlassOiBar[] = Array.from({ length: LEN }, (_, i) => {
      let c = 100;
      if (i === ANCHOR_PREV) c = 100; // 高点侧锚点 1
      else if (i === ANCHOR_CURR) c = 80; // 高点侧锚点 2，-20%
      else if (i === LOW_PREV) c = 100; // 低点侧锚点 1
      else if (i === LOW_CURR) c = 120; // 低点侧锚点 2，+20%
      return { time: i * 1_800_000, open: String(c), high: c, low: String(c), close: c };
    });

    expect(oiDivergence(priceBars, oiBars)).toBe(-1);
  });

  it("返回值恒在 [-1, 1]", () => {
    for (const oiPct of [-50, -20, -5, -1, 0, 1, 5, 20, 50]) {
      const curr = 100 * (1 + oiPct / 100);
      const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, curr);

      const highOnly = oiDivergence(priceBarsFrom(twoPeakHighs(5), flat(1)), oiBars);
      expect(highOnly).toBeGreaterThanOrEqual(-1);
      expect(highOnly).toBeLessThanOrEqual(1);

      const lowOnly = oiDivergence(priceBarsFrom(flat(1000), twoTroughLows(5)), oiBars);
      expect(lowOnly).toBeGreaterThanOrEqual(-1);
      expect(lowOnly).toBeLessThanOrEqual(1);

      const both = oiDivergence(priceBarsFrom(twoPeakHighs(5), twoTroughLows(5)), oiBars);
      expect(both).toBeGreaterThanOrEqual(-1);
      expect(both).toBeLessThanOrEqual(1);
    }
  });
});

describe("PIVOT_N", () => {
  it("保持为 1——确认滞后 30 分钟；这个值同时决定本文件夹具的结构，改动前先改夹具", () => {
    // 5 → 2 → 1，一路压确认滞后（2.5 小时 → 1 小时 → 30 分钟），
    // 1 是这个粒度下的下限：再小就没有「左右两侧」可言了。
    // 副作用是摆动点变多变噪，而且 oiDivergence 的两条阈值是在 5 的前提下
    // 量出来的，分数会系统性偏低——这条断言存在的意义就是让下一次改动
    // 必须先看到这段。
    expect(PIVOT_N).toBe(1);
  });
});
