import { describe, it, expect } from "vitest";
import {
  classifyScenario,
  absorptionStrengthOk,
  RECLAIM_PCT_MIN,
  SLOPE_RATIO_MIN,
  SLOPE_MIN_BARS,
} from "./scenario";
import type { CoinGlassPriceBar, CoinGlassOiBar, CoinGlassTakerBar } from "@/lib/coinglass/types";

const B = 1_800_000;
const GROSS = 1000;

/**
 * 三条同长度序列的构造器。
 *
 * price 给收盘价，wick 可选地覆盖某几根的最高/最低（造 sweep 用）；
 * cvd 给**累积线**的目标值（内部换算成逐根净流）；oi 给持仓量。
 *
 * 摆动点要左右各 5 根都不更极端，所以任何一个极值前后都得留够 5 根空白，
 * 下面的样本序列都按这个节奏排。
 */
function build(
  price: number[],
  cvd: number[],
  oi: number[],
  wick: Record<number, [high: number, low: number]> = {}
): [CoinGlassPriceBar[], CoinGlassOiBar[], CoinGlassTakerBar[]] {
  const bars: CoinGlassPriceBar[] = price.map((p, i) => {
    const [high, low] = wick[i] ?? [p * 1.002, p * 0.998];
    return {
      time: i * B,
      open: String(p),
      high: String(high),
      low: String(low),
      close: String(p),
      volume_usd: "1000",
    };
  });
  const oiBars: CoinGlassOiBar[] = oi.map((v, i) => ({
    time: i * B,
    open: v,
    high: v,
    low: v,
    close: v,
  }));
  const taker: CoinGlassTakerBar[] = cvd.map((v, i) => {
    const delta = i === 0 ? v : v - cvd[i - 1];
    return {
      time: i * B,
      aggregated_buy_volume_usd: String((GROSS + delta) / 2),
      aggregated_sell_volume_usd: String((GROSS - delta) / 2),
    };
  });
  return [bars, oiBars, taker];
}

/** 重复 n 次 v */
const rep = (n: number, v: number) => Array.from({ length: n }, () => v);
/** 线性从 a 到 b，共 n 个点 */
const ramp = (n: number, a: number, b: number) =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));

describe("classifyScenario —— 守卫", () => {
  it("三条序列长度对不上时直接判空，绝不拿错位的数据出场景", () => {
    const [b, o, t] = build(rep(30, 100), rep(30, 0), rep(30, 1000));
    expect(classifyScenario(b, o.slice(0, 29), t)).toBeNull();
    expect(classifyScenario(b, o, t.slice(0, 29))).toBeNull();
  });

  it("根数不足以产生摆动点时判空", () => {
    const [b, o, t] = build(rep(8, 100), rep(8, 0), rep(8, 1000));
    expect(classifyScenario(b, o, t)).toBeNull();
  });

  it("CVD 序列有坏数据时判空——累积线断一根，后面全是错的", () => {
    const [b, o, t] = build(rep(30, 100), rep(30, 0), rep(30, 1000));
    t[10] = { ...t[10], aggregated_buy_volume_usd: "abc" };
    expect(classifyScenario(b, o, t)).toBeNull();
  });

  it("完全没有结构的横盘不产生任何场景", () => {
    const [b, o, t] = build(rep(40, 100), rep(40, 0), rep(40, 1000));
    expect(classifyScenario(b, o, t)).toBeNull();
  });
});

describe("classifyScenario —— 陷阱优先", () => {
  /**
   * 假顶背离：价格守在高位没回落 + CVD 剧烈走弱 + OI 暴增。
   *
   * 方向是**反直觉**的：看着像背离该反手做空，实际那批逆势追空的新仓
   * （OI 暴增）才是待收割的一方，所以判定是「禁止做空，顺势做多」。
   * 这个方向写反了不会报错，只会让每次陷阱都把人送进被轧的那一边。
   */
  it("高位 + CVD 剧烈走弱 + OI 暴增 = 假顶背离，方向是做多", () => {
    // 价格造两个抬高的高点，之后守住不回落
    const price = [...rep(5, 100), 110, ...rep(5, 105), 120, ...rep(8, 119)];
    // CVD 一路重挫：净流占换手要跌破 -10%
    const cvd = [...rep(11, 0), ...ramp(9, 0, -8000)];
    // OI 暴增：远超 +7%
    const oi = [...rep(11, 1000), ...ramp(9, 1000, 1400)];
    const [b, o, t] = build(price, cvd, oi);
    const s = classifyScenario(b, o, t)!;
    expect(s.kind).toBe("trap_false_top_div");
    expect(s.direction).toBe("long");
    expect(s.trap).toBe(true);
  });

  it("低位 + CVD 剧烈走强 + OI 暴增 = 假底背离，方向是做空", () => {
    const price = [...rep(5, 120), 110, ...rep(5, 115), 100, ...rep(8, 101)];
    const cvd = [...rep(11, 0), ...ramp(9, 0, 8000)];
    const oi = [...rep(11, 1000), ...ramp(9, 1000, 1400)];
    const [b, o, t] = build(price, cvd, oi);
    const s = classifyScenario(b, o, t)!;
    expect(s.kind).toBe("trap_false_bottom_div");
    expect(s.direction).toBe("short");
    expect(s.trap).toBe(true);
  });

  it("CVD 只是普通走弱、没到「剧烈」= 不是陷阱", () => {
    const price = [...rep(5, 100), 110, ...rep(5, 105), 120, ...rep(8, 119)];
    const cvd = [...rep(11, 0), ...ramp(9, 0, -300)]; // 净流占比远达不到 -10%
    const oi = [...rep(11, 1000), ...ramp(9, 1000, 1400)];
    const [b, o, t] = build(price, cvd, oi);
    const s = classifyScenario(b, o, t);
    expect(s?.trap ?? false).toBe(false);
  });

  it("OI 只是普通增加、没到「暴增」= 不是陷阱", () => {
    const price = [...rep(5, 100), 110, ...rep(5, 105), 120, ...rep(8, 119)];
    const cvd = [...rep(11, 0), ...ramp(9, 0, -8000)];
    const oi = [...rep(11, 1000), ...ramp(9, 1000, 1030)]; // 只 +3%
    const [b, o, t] = build(price, cvd, oi);
    const s = classifyScenario(b, o, t);
    expect(s?.trap ?? false).toBe(false);
  });
});

describe("classifyScenario —— 输出契约", () => {
  it("凡是判出场景，必带一条合法的失效线", () => {
    // 规格：每个场景都要有明确失效位，没有就不成立。这条属性对所有场景
    // 都必须成立，所以拿一批不同形状的序列一起扫。
    const cases: Array<[number[], number[], number[]]> = [
      [
        [...rep(5, 100), 110, ...rep(5, 105), 120, ...rep(8, 119)],
        [...rep(11, 0), ...ramp(9, 0, -8000)],
        [...rep(11, 1000), ...ramp(9, 1000, 1400)],
      ],
      [
        [...rep(5, 120), 110, ...rep(5, 115), 100, ...rep(8, 101)],
        [...rep(11, 0), ...ramp(9, 0, 8000)],
        [...rep(11, 1000), ...ramp(9, 1000, 1400)],
      ],
    ];
    for (const [p, c, o] of cases) {
      const [bb, oo, tt] = build(p, c, o);
      const s = classifyScenario(bb, oo, tt);
      if (!s) continue;
      expect(Number.isFinite(s.invalidation.price)).toBe(true);
      expect(s.invalidation.price).toBeGreaterThan(0);
      expect(["above", "below"]).toContain(s.invalidation.breach);
      expect(Number.isFinite(s.triggeredAt)).toBe(true);
    }
  });

  it("triggeredAt 落在序列真实存在的时刻上", () => {
    const price = [...rep(5, 100), 110, ...rep(5, 105), 120, ...rep(8, 119)];
    const cvd = [...rep(11, 0), ...ramp(9, 0, -8000)];
    const oi = [...rep(11, 1000), ...ramp(9, 1000, 1400)];
    const [b, o, t] = build(price, cvd, oi);
    const s = classifyScenario(b, o, t)!;
    expect(b.some((x) => x.time === s.triggeredAt)).toBe(true);
  });
});

/**
 * A3/B3 力度扳机第 ② 条的边界。
 *
 * 规格：**优先用回补比例**（反转段 CVD 涨幅 ÷ 整段下跌 CVD 跌幅 > 30%）；
 * 斜率 > 1.5 倍那条**只在反转段已有 3 根以上 30m K 线时才启用**。
 *
 * 为什么斜率要设这道闸：斜率比要除以反转段的根数，根数只有 1–2 时分母极小，
 * 一根凶一点的 K 线就能把比值推到远超 1.5——那不是力度达标，是除数太小。
 */
describe("absorptionStrengthOk", () => {
  // 下跌段固定：跌 100，用了 10 根
  const decline = [100, 10] as const;
  const ok = (reboundMove: number, reboundSpan: number) =>
    absorptionStrengthOk(decline[0], decline[1], reboundMove, reboundSpan);

  it("回补超过 30% 就算数，哪怕反转段只有 1 根", () => {
    // 主口径是两个幅度的比值，跟根数无关，所以不受那道闸限制。
    expect(ok(31, 1)).toBe(true);
  });

  it("回补恰好 30% 不算——门槛是「> 30%」", () => {
    expect(ok(RECLAIM_PCT_MIN, 1)).toBe(false);
  });

  it("回补不够、反转段只有 2 根时，斜率再陡也不启用", () => {
    // 反转 25（占跌幅 25%，不到 30%），只用了 2 根：
    // 斜率比 = (25/2) ÷ (100/10) = 1.25 …… 就算把它拉到 10 倍也一样不认。
    expect(ok(25, 2)).toBe(false);
    expect(ok(29, 1)).toBe(false); // 一根就回补 29%，斜率比高达 2.9，仍然不认
  });

  it("反转段够 3 根、斜率过线才算数", () => {
    // 反转 25（25% < 30%），3 根：斜率比 = (25/3) ÷ 10 = 0.83 → 不够
    expect(ok(25, SLOPE_MIN_BARS)).toBe(false);
    // 反转 50（50% > 30%）本来主口径就过了，换个不触发主口径的：
    // 反转 29（29% < 30%），根数 1.5 倍要求 → 需要 (29/n)÷10 > 1.5 → n < 1.93
    // 也就是说 3 根时斜率永远不可能过——这正是「主口径优先」的实际效果。
    expect(ok(29, 3)).toBe(false);
  });

  it("斜率口径真正能起作用的是「下跌很慢、反转不算快但相对更陡」那种", () => {
    // 下跌段：跌 100 用了 100 根（很慢，平均斜率 1）
    // 反转段：涨 20（20% < 30%，主口径不过）用了 4 根 → 斜率 5 ÷ 1 = 5 > 1.5
    expect(absorptionStrengthOk(100, 100, 20, 4)).toBe(true);
    // 同样的形状但只有 2 根反转 → 闸门挡住
    expect(absorptionStrengthOk(100, 100, 10, 2)).toBe(false);
  });

  it("斜率恰好等于 1.5 不算——门槛是「> 1.5 倍」", () => {
    // 下跌 100/100 根 → 平均 1。反转段 n 根、幅度 1.5n 时斜率恰好 1.5。
    const n = 4;
    expect(absorptionStrengthOk(100, 100, SLOPE_RATIO_MIN * n, n)).toBe(false);
  });

  it("非法输入一律不算数，不靠除法自己冒 NaN/Infinity", () => {
    expect(absorptionStrengthOk(0, 10, 50, 5)).toBe(false); // 下跌幅度为 0
    expect(absorptionStrengthOk(100, 0, 50, 5)).toBe(false); // 下跌根数为 0
    expect(absorptionStrengthOk(100, 10, 50, 0)).toBe(false); // 反转根数为 0
    expect(absorptionStrengthOk(100, 10, NaN, 5)).toBe(false);
  });
});
