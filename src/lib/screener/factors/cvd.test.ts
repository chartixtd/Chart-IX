import { describe, it, expect } from "vitest";
import { cvdNorm, cvdScore, CVD_WINDOW_BARS } from "./cvd";
import type { CoinGlassTakerBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

function taker(deltas: number[], gross = 1000): CoinGlassTakerBar[] {
  // 每根总成交额固定为 gross，买卖按 delta 拆开
  return deltas.map((d, i) => ({
    time: i * 1_800_000,
    taker_buy_volume_usd: String((gross + d) / 2),
    taker_sell_volume_usd: String((gross - d) / 2),
  }));
}

function priceBars(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
    volume_usd: "1000",
  }));
}

const FLAT_PRICE = priceBars(Array.from({ length: 20 }, () => 100));
const RISING_PRICE = priceBars(Array.from({ length: 20 }, (_, i) => 100 + i));
const FALLING_PRICE = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i));

describe("cvdNorm", () => {
  it("持续净买入是正数、持续净卖出是负数", () => {
    expect(cvdNorm(taker(Array(20).fill(200)), CVD_WINDOW_BARS)!).toBeGreaterThan(0);
    expect(cvdNorm(taker(Array(20).fill(-200)), CVD_WINDOW_BARS)!).toBeLessThan(0);
  });

  it("买卖持平时接近 0", () => {
    expect(Math.abs(cvdNorm(taker(Array(20).fill(0)), CVD_WINDOW_BARS)!)).toBeLessThan(0.05);
  });

  it("恒在 [-1, 1]——分母是同期换手总量，不受币的绝对体量影响", () => {
    for (const d of [1000, -1000, 999999, -999999]) {
      const v = cvdNorm(taker(Array(20).fill(d), 1000), CVD_WINDOW_BARS)!;
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("样本不足返回 null", () => {
    expect(cvdNorm(taker([100, 100]), CVD_WINDOW_BARS)).toBeNull();
    expect(cvdNorm([], CVD_WINDOW_BARS)).toBeNull();
  });
});

describe("cvdScore", () => {
  it("数据缺失给方向分中性 5、背离分 0，合计 5", () => {
    expect(cvdScore([], FLAT_PRICE, "long")).toBe(5);
    expect(cvdScore(taker(Array(20).fill(100)), [], "long")).toBe(5);
  });

  it("价格下跌但 CVD 上行 = 跌中承接，背离分在方向分之上再叠一大块", () => {
    const flow = taker(Array(20).fill(800));
    // 同一份资金流，只改价格走势：逆行时才拿得到背离分，走平时拿不到。
    // 用差值而不是绝对阈值断言，测的才是「背离分真的在加分」这条性质本身。
    const diverging = cvdScore(flow, FALLING_PRICE, "long");
    const flat = cvdScore(flow, FLAT_PRICE, "long");
    expect(diverging).toBeGreaterThan(flat + 5);
    // 方向分 9（norm=0.8）+ 背离分 8（priceLeg 封顶 1 × flowLeg 0.8）
    expect(diverging).toBeCloseTo(17, 5);
  });

  it("价格上涨但 CVD 下行 = 拉高出货，做空同样叠上背离分", () => {
    const flow = taker(Array(20).fill(-800));
    const diverging = cvdScore(flow, RISING_PRICE, "short");
    const flat = cvdScore(flow, FLAT_PRICE, "short");
    expect(diverging).toBeGreaterThan(flat + 5);
    expect(diverging).toBeCloseTo(17, 5);
  });

  it("同向时背离分给 0 而不是负分——同向的价值已经在方向分里算过一次", () => {
    // 价涨 + CVD 涨，做多：方向分接近满分 10，背离分 0
    const score = cvdScore(taker(Array(20).fill(800)), RISING_PRICE, "long");
    expect(score).toBeLessThanOrEqual(10.01);
    expect(score).toBeGreaterThan(8);
  });

  it("背离幅度越大分越高", () => {
    const shallow = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.02));
    const deep = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.5));
    const a = cvdScore(taker(Array(20).fill(800)), shallow, "long");
    const b = cvdScore(taker(Array(20).fill(800)), deep, "long");
    expect(b).toBeGreaterThan(a);
  });

  it("分数恒在 [0, 20]", () => {
    const cases: Array<[number[], CoinGlassPriceBar[]]> = [
      [Array(20).fill(999), RISING_PRICE],
      [Array(20).fill(-999), FALLING_PRICE],
      [Array(20).fill(0), FLAT_PRICE],
    ];
    for (const [d, p] of cases) {
      for (const dir of ["long", "short"] as const) {
        const v = cvdScore(taker(d), p, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(20);
      }
    }
  });
});
