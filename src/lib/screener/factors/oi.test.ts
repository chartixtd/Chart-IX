import { describe, it, expect } from "vitest";
import { oiScore, quadrantScore, priceChangeOverBars, OI_DEADZONE_PCT, PRICE_DEADZONE_PCT } from "./oi";
import type { CoinGlassOiBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

/** 造一段 30m K 线，收盘价按给定序列走 */
function barsFromCloses(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c * 1.001),
    low: String(c * 0.999),
    close: String(c),
    volume_usd: "1000",
  }));
}

/**
 * 造一段 OI 收盘价序列，使得 priceChangeOverBars 在 barsBack=1/2/8（对应 30m/1h/4h）
 * 时分别算出给定的百分比。长度固定 9 根（`bars.length > 8` 是 barsBack=8 能算出
 * 结果的最短长度）——刻意比下面 oiScore 测试用的 `rising` 价格序列（20 根）短，
 * 这样两条序列长度不等，oiDivergence 会直接返回 0（见 oi-divergence.ts 的长度
 * 校验），背离修正项不会干扰这组只测象限算法的用例。背离本身有专门的
 * oi-divergence.test.ts。
 */
function oiBarsFromWindowPcts(p30m: number, p1h: number, p4h: number): CoinGlassOiBar[] {
  const now = 100;
  const closes = new Array(9).fill(now);
  closes[7] = now / (1 + p30m / 100); // 1 根之前 = 30m
  closes[6] = now / (1 + p1h / 100); // 2 根之前 = 1h
  closes[0] = now / (1 + p4h / 100); // 8 根之前 = 4h
  closes[8] = now;
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
  }));
}

describe("priceChangeOverBars", () => {
  it("按「多少根之前」算涨跌百分比", () => {
    // 100 → 110，两根之前
    expect(priceChangeOverBars(barsFromCloses([100, 105, 110]), 2)).toBeCloseTo(10);
  });

  it("K 线不够长时返回 null，而不是拿最早那根凑数", () => {
    expect(priceChangeOverBars(barsFromCloses([100, 110]), 8)).toBeNull();
  });
});

describe("quadrantScore", () => {
  it("OI 涨 + 价涨 = 新多头进场，做多满分、做空 0", () => {
    expect(quadrantScore(5, 5, "long")).toBe(100);
    expect(quadrantScore(5, 5, "short")).toBe(0);
  });

  it("OI 涨 + 价跌 = 新空头进场，做空满分、做多 0", () => {
    expect(quadrantScore(5, -5, "short")).toBe(100);
    expect(quadrantScore(5, -5, "long")).toBe(0);
  });

  it("OI 跌 + 价涨 = 空头回补，两边都只给中低分", () => {
    expect(quadrantScore(-5, 5, "long")).toBe(40);
    expect(quadrantScore(-5, 5, "short")).toBe(30);
  });

  it("OI 跌 + 价跌 = 多头离场，两边都只给中低分", () => {
    expect(quadrantScore(-5, -5, "long")).toBe(30);
    expect(quadrantScore(-5, -5, "short")).toBe(40);
  });

  it("OI 变化落在死区内给中性 50——微小变化的正负号是噪音不是象限", () => {
    expect(quadrantScore(OI_DEADZONE_PCT / 2, 5, "long")).toBe(50);
  });

  it("价格变化落在死区内同样给中性 50", () => {
    expect(quadrantScore(5, PRICE_DEADZONE_PCT / 2, "long")).toBe(50);
  });

  it("OI 变化越小越向 50 收缩", () => {
    const weak = quadrantScore(0.6, 5, "long");
    const strong = quadrantScore(5, 5, "long");
    expect(weak).toBeLessThan(strong);
    expect(weak).toBeGreaterThan(50);
  });
});

describe("oiScore", () => {
  const rising = barsFromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));

  it("拿不到 OI 序列（空数组）给中性 15", () => {
    expect(oiScore([], rising, "long")).toBe(15);
  });

  it("三个窗口 OI 齐涨 + 价格齐涨 → 做多接近满分", () => {
    expect(oiScore(oiBarsFromWindowPcts(5, 5, 5), rising, "long")).toBeGreaterThan(27);
  });

  it("同样的数据对做空接近 0", () => {
    expect(oiScore(oiBarsFromWindowPcts(5, 5, 5), rising, "short")).toBeLessThan(3);
  });

  it("短窗口权重高于长窗口——15 分钟扫描要抓的是刚发生的资金动作", () => {
    const shortWindowBull = oiScore(oiBarsFromWindowPcts(5, 0, 0), rising, "long");
    const longWindowBull = oiScore(oiBarsFromWindowPcts(0, 0, 5), rising, "long");
    expect(shortWindowBull).toBeGreaterThan(longWindowBull);
  });

  it("分数恒在 [0, 30]", () => {
    for (const bars of [
      oiBarsFromWindowPcts(50, 50, 50),
      oiBarsFromWindowPcts(-50, -50, -50),
      oiBarsFromWindowPcts(0, 0, 0),
    ]) {
      for (const dir of ["long", "short"] as const) {
        const v = oiScore(bars, rising, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(30);
      }
    }
  });
});
