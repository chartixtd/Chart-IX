import { describe, it, expect } from "vitest";
import { classifyScenario } from "./scenario";
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
