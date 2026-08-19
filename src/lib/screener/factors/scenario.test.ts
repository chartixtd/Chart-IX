import { describe, it, expect } from "vitest";
import {
  classifyScenario,
  SCENARIO_CVD_ALIGN_MIN,
  SCENARIO_CVD_EXTREME_MIN,
  SCENARIO_OI_CHANGE_MIN,
  SCENARIO_OI_SURGE_MIN,
} from "./scenario";
import { PIVOT_N, PRICE_EXTREME_MIN_PCT } from "./oi-divergence";
import type { CoinGlassPriceBar, CoinGlassOiBar, CoinGlassTakerBar } from "@/lib/coinglass/types";

/**
 * 构造两峰/两谷价格序列，与 oi-divergence.test.ts 的 buildTwoExtremeSeries
 * 同一个套路（显式下标赋值，避免数错元素个数）。两个摆动点固定在
 * ANCHOR_PREV=5、ANCHOR_CURR=17，PIVOT_N=5 时两端都能确认。
 */
const ANCHOR_PREV = 5;
const ANCHOR_CURR = 17;
const SERIES_LEN = 23;

function buildTwoExtremeSeries(extreme1: number, extreme2: number): number[] {
  const values = new Array(SERIES_LEN).fill(0);
  const ramp1 = [90, 92, 94, 96, 98].map((v) => (v / 100) * extreme1);
  const ramp2 = [0.9, 0.93, 0.95, 0.97, 0.99].map((v) => v * extreme2);

  for (let i = 0; i < 5; i++) values[i] = ramp1[i];
  values[ANCHOR_PREV] = extreme1;
  for (let i = 0; i < 5; i++) values[ANCHOR_PREV + 1 + i] = ramp1[4 - i];
  values[11] = Math.min(ramp1[0], ramp2[0]) * 0.9;

  for (let i = 0; i < 5; i++) values[12 + i] = ramp2[i];
  values[ANCHOR_CURR] = extreme2;
  for (let i = 0; i < 5; i++) values[ANCHOR_CURR + 1 + i] = ramp2[4 - i];

  return values;
}

/** 两峰：index 5 与 17 是局部最高点，17 处的值比 5 处高 pctHigher% */
function twoPeakHighs(pctHigher: number): number[] {
  const peak1 = 100;
  const peak2 = peak1 * (1 + pctHigher / 100);
  return buildTwoExtremeSeries(peak1, peak2);
}

/** 两谷：index 5 与 17 是局部最低点，17 处的值比 5 处低 pctLower% */
function twoTroughLows(pctLower: number): number[] {
  const trough1 = 100;
  const trough2 = trough1 * (1 - pctLower / 100);
  const peaks = buildTwoExtremeSeries(200 - trough1, 200 - trough2);
  return peaks.map((v) => 200 - v);
}

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

/** 只在 index 5 与 17 放有意义的 OI 收盘值，其余下标不参与计算（同 oi-divergence.test.ts）。 */
function oiBarsWithAnchors(len: number, valAtPrev: number, valAtCurr: number): CoinGlassOiBar[] {
  return Array.from({ length: len }, (_, i) => {
    let c = 100;
    if (i === ANCHOR_PREV) c = valAtPrev;
    else if (i === ANCHOR_CURR) c = valAtCurr;
    return { time: i * 1_800_000, open: String(c), high: c, low: String(c), close: c };
  });
}

/**
 * 主动买卖序列全长按同一个比例填：cvdPct 只在区间 (i1,i2] 上求和，
 * 但因为每一根的 (买-卖)/(买+卖) 比例都相同，任意子区间求和后的比例
 * 都精确等于这个目标比例，不需要关心两个摆动点具体落在哪——这样可以
 * 直接把 gross/net 反推成常数 buy/sell，不用逐根凑数。
 */
function takerBarsUniform(len: number, cvdPct: number): CoinGlassTakerBar[] {
  const gross = 1000;
  const net = (cvdPct / 100) * gross;
  const buy = (gross + net) / 2;
  const sell = (gross - net) / 2;
  return Array.from({ length: len }, (_, i) => ({
    time: i * 1_800_000,
    taker_buy_volume_usd: String(buy),
    taker_sell_volume_usd: String(sell),
  }));
}

describe("classifyScenario · 高点侧四格", () => {
  it("CVD≥+2 且 OI≥+1 → 健康趋势，long，非陷阱", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 102); // +2%
    const takerBars = takerBarsUniform(SERIES_LEN, 3); // +3%，过了 ALIGN 门槛
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("healthy_trend");
    expect(s!.direction).toBe("long");
    expect(s!.trap).toBe(false);
    expect(s!.side).toBe("high");
  });

  it("CVD≥+2 且 OI≤-1 → 存量清算，manage", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 98); // -2%
    const takerBars = takerBarsUniform(SERIES_LEN, 3);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("inventory_flush");
    expect(s!.direction).toBe("manage");
    expect(s!.trap).toBe(false);
  });

  it("CVD≤-2 且 OI≤-1 → 真顶背离，short", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 98); // -2%
    const takerBars = takerBarsUniform(SERIES_LEN, -3);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("true_top_div");
    expect(s!.direction).toBe("short");
    expect(s!.trap).toBe(false);
  });

  it("CVD≤-10 且 OI≥+7 → 假顶背离（陷阱），禁空转多", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 108); // +8%
    const takerBars = takerBarsUniform(SERIES_LEN, -15);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("false_top_div");
    expect(s!.direction).toBe("long");
    expect(s!.trap).toBe(true);
  });
});

describe("classifyScenario · 低点侧四格（镜像）", () => {
  it("CVD≤-2 且 OI≥+1 → 健康趋势，short", () => {
    const priceBars = priceBarsFrom(flat(1000), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 102); // +2%
    const takerBars = takerBarsUniform(SERIES_LEN, -3);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("healthy_trend");
    expect(s!.direction).toBe("short");
    expect(s!.trap).toBe(false);
    expect(s!.side).toBe("low");
  });

  it("CVD≤-2 且 OI≤-1 → 存量清算，manage", () => {
    const priceBars = priceBarsFrom(flat(1000), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 98); // -2%
    const takerBars = takerBarsUniform(SERIES_LEN, -3);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("inventory_flush");
    expect(s!.direction).toBe("manage");
    expect(s!.trap).toBe(false);
  });

  it("CVD≥+2 且 OI≤-1 → 真底背离，long", () => {
    const priceBars = priceBarsFrom(flat(1000), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 98); // -2%
    const takerBars = takerBarsUniform(SERIES_LEN, 3);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("true_bottom_div");
    expect(s!.direction).toBe("long");
    expect(s!.trap).toBe(false);
  });

  it("CVD≥+10 且 OI≥+7 → 假底背离（陷阱），禁多转空", () => {
    const priceBars = priceBarsFrom(flat(1000), twoTroughLows(5));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 108); // +8%
    const takerBars = takerBarsUniform(SERIES_LEN, 15);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("false_bottom_div");
    expect(s!.direction).toBe("short");
    expect(s!.trap).toBe(true);
  });
});

describe("classifyScenario · 阈值边界（恰好等于门槛也算数，≥/≤ 都是闭区间）", () => {
  it("CVD 恰好 +2（SCENARIO_CVD_ALIGN_MIN）→ 仍算健康趋势", () => {
    expect(SCENARIO_CVD_ALIGN_MIN).toBe(2);
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 101); // 恰好 +1
    const takerBars = takerBarsUniform(SERIES_LEN, 2); // 恰好 +2
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s?.kind).toBe("healthy_trend");
  });

  it("CVD 恰好 -10（SCENARIO_CVD_EXTREME_MIN）且 OI 恰好 +7（SCENARIO_OI_SURGE_MIN）→ 仍算假顶背离", () => {
    expect(SCENARIO_CVD_EXTREME_MIN).toBe(10);
    expect(SCENARIO_OI_SURGE_MIN).toBe(7);
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 107); // 恰好 +7
    const takerBars = takerBarsUniform(SERIES_LEN, -10); // 恰好 -10
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s?.kind).toBe("false_top_div");
  });

  it("OI 恰好 -1（SCENARIO_OI_CHANGE_MIN）→ 仍算真顶背离", () => {
    expect(SCENARIO_OI_CHANGE_MIN).toBe(1);
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 99); // 恰好 -1
    const takerBars = takerBarsUniform(SERIES_LEN, -3);
    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s?.kind).toBe("true_top_div");
  });

  it("CVD 差一点没到 +2（1.9）→ 任何格子都不命中，返回 null", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 102);
    const takerBars = takerBarsUniform(SERIES_LEN, 1.9);
    expect(classifyScenario(priceBars, oiBars, takerBars)).toBeNull();
  });
});

describe("classifyScenario · 边界情形", () => {
  it("新高幅度不足 PRICE_EXTREME_MIN_PCT(1%) → 返回 null（即使 CVD/OI 都达标）", () => {
    expect(PRICE_EXTREME_MIN_PCT).toBe(1);
    const priceBars = priceBarsFrom(twoPeakHighs(0.3), flat(1)); // 只新高 0.3%
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 102);
    const takerBars = takerBarsUniform(SERIES_LEN, 3);
    expect(classifyScenario(priceBars, oiBars, takerBars)).toBeNull();
  });

  it("三条序列长度不等 → 返回 null，不按下标硬取", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN - 1, 100, 102); // 少一根
    const takerBars = takerBarsUniform(SERIES_LEN, 3);
    expect(classifyScenario(priceBars, oiBars, takerBars)).toBeNull();
  });

  it("taker 序列长度与另外两条不等 → 返回 null", () => {
    const priceBars = priceBarsFrom(twoPeakHighs(5), flat(1));
    const oiBars = oiBarsWithAnchors(SERIES_LEN, 100, 102);
    const takerBars = takerBarsUniform(SERIES_LEN - 1, 3); // 少一根
    expect(classifyScenario(priceBars, oiBars, takerBars)).toBeNull();
  });

  it("已确认摆动点不足两个（样本不足）→ 返回 null", () => {
    const shortHighs = Array.from({ length: 12 }, (_, i) => 100 + i); // 单调上升，findPivots 找不到已确认高点
    const shortLows = new Array(12).fill(1);
    const priceBars = priceBarsFrom(shortHighs, shortLows);
    const oiBars = oiBarsWithAnchors(12, 100, 80);
    const takerBars = takerBarsUniform(12, 3);
    expect(classifyScenario(priceBars, oiBars, takerBars)).toBeNull();
  });

  it("PIVOT_N 保持 5——这个值决定夹具结构，改动前先改夹具", () => {
    expect(PIVOT_N).toBe(5);
  });
});

describe("classifyScenario · 两侧都有场景时取更晚确认的那一侧", () => {
  it("高点侧摆动对确认于 index 17、低点侧确认于 index 18 → 取低点侧的场景", () => {
    // 复用 oi-divergence.test.ts「同号叠加」用例的构造思路：把低点侧的摆动点
    // 位置错开一格（6、18），让高低两侧的 OI 读数落在不同下标、互不相干，
    // 才能各自独立控制两侧的分类结果，不是巧合重合。
    const LOW_PREV = 6;
    const LOW_CURR = 18;
    const LEN = 24;

    const highs = [...twoPeakHighs(5), twoPeakHighs(5)[SERIES_LEN - 1]];

    const lows = new Array(LEN).fill(0);
    const lowRamp1 = [112, 110, 108, 106, 104, 102];
    for (let i = 0; i < lowRamp1.length; i++) lows[i] = lowRamp1[i];
    lows[LOW_PREV] = 100;
    const lowMirror1 = [102, 104, 106, 108, 110];
    for (let i = 0; i < lowMirror1.length; i++) lows[LOW_PREV + 1 + i] = lowMirror1[i];
    lows[12] = 110;
    const lowRamp2 = [105, 103, 101, 99, 97];
    for (let i = 0; i < lowRamp2.length; i++) lows[13 + i] = lowRamp2[i];
    lows[LOW_CURR] = 95; // 谷 2，比谷 1 低 5%
    const lowMirror2 = [97, 99, 101, 103, 105];
    for (let i = 0; i < lowMirror2.length; i++) lows[LOW_CURR + 1 + i] = lowMirror2[i];

    const priceBars = priceBarsFrom(highs, lows);

    // 高点侧 (5,17)：OI -2%，CVD 原始 -3%（同向判定要 signedCvd=cvdPct，
    // -3 ≤ -2 且 OI -2 ≤ -1 → 真顶背离，short，side="high"，i2=17）。
    // 低点侧 (6,18)：OI +2%，CVD 原始同一份序列，还是 -3%（signedCvd=-cvdPct=+3，
    // +3 ≥ +2 且 OI +2 ≥ +1 → 健康趋势，short，side="low"，i2=18）。
    // 两侧同时命中，18 > 17，取低点侧。
    const oiBars: CoinGlassOiBar[] = Array.from({ length: LEN }, (_, i) => {
      let c = 100;
      if (i === ANCHOR_PREV) c = 100;
      else if (i === ANCHOR_CURR) c = 98; // 高点侧 -2%
      else if (i === LOW_PREV) c = 100;
      else if (i === LOW_CURR) c = 102; // 低点侧 +2%
      return { time: i * 1_800_000, open: String(c), high: c, low: String(c), close: c };
    });
    const takerBars = takerBarsUniform(LEN, -3);

    const s = classifyScenario(priceBars, oiBars, takerBars);
    expect(s).not.toBeNull();
    expect(s!.side).toBe("low");
    expect(s!.kind).toBe("healthy_trend");
    expect(s!.direction).toBe("short");
  });
});
