import { describe, it, expect } from "vitest";
import { sweepScore, spikeRatio, SWEEP_SPIKE_MIN } from "./sweep";
import type { CoinGlassLiquidationBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

function liqSeries(longs: number[], shorts: number[]): CoinGlassLiquidationBar[] {
  return longs.map((l, i) => ({
    time: i * 1_800_000,
    long_liquidation_usd: String(l),
    short_liquidation_usd: String(shorts[i] ?? 0),
  }));
}

/** 一根有长下影且已收回的 K 线：low 远低于实体，close 在上半段 */
function hammer(i: number): CoinGlassPriceBar {
  return { time: i * 1_800_000, open: "100", high: "101", low: "90", close: "100.5", volume_usd: "1000" };
}

/** 一根普通的小实体 K 线，几乎没有影线 */
function doji(i: number): CoinGlassPriceBar {
  return { time: i * 1_800_000, open: "100", high: "100.4", low: "99.8", close: "100.2", volume_usd: "1000" };
}

/** 一根有长上影且已回落的 K 线 */
function shootingStar(i: number): CoinGlassPriceBar {
  return { time: i * 1_800_000, open: "100", high: "112", low: "99.5", close: "100.2", volume_usd: "1000" };
}

const FLAT = Array.from({ length: 48 }, (_, i) => doji(i));

describe("spikeRatio", () => {
  it("中位数为 0 时不返回 Infinity", () => {
    const { ratio } = spikeRatio([0, 0, 0, 0, 0, 0, 500]);
    expect(Number.isFinite(ratio)).toBe(true);
  });

  it("把峰值所在下标一起返回，供收回确认定位那根 K 线", () => {
    const { index } = spikeRatio([10, 10, 900, 10]);
    expect(index).toBe(2);
  });

  it("用中位数而不是均值当基线——均值会被峰值自己抬上去", () => {
    // 中位数 = 10000，均值 ≈ 122500。用中位数算 spike 是 90，
    // 用均值只有 7.3——会被 SWEEP_SPIKE_MIN(3) 之上的曲线严重低估。
    const { ratio } = spikeRatio([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 900_000]);
    expect(ratio).toBeGreaterThan(50);
  });
});

describe("sweepScore", () => {
  const flatLiq = liqSeries(Array(48).fill(1000), Array(48).fill(1000));

  it("没有任何爆仓数据给 0 分，而不是中性分——事件型因子没发生就是没发生", () => {
    expect(sweepScore([], FLAT, "long")).toBe(0);
  });

  it("整条序列全 0 也给接近 0 分，不因除零变满分", () => {
    const zeros = liqSeries(Array(48).fill(0), Array(48).fill(0));
    expect(sweepScore(zeros, FLAT, "long")).toBeLessThan(1);
  });

  it("爆仓平淡时接近 0 分", () => {
    expect(sweepScore(flatLiq, FLAT, "long")).toBeLessThan(1);
  });

  it("多头爆仓放量 + 长下影收回 → 做多高分", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 50_000;
    const bars = FLAT.slice();
    bars[46] = hammer(46);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "long")).toBeGreaterThan(14);
  });

  it("同一次多头爆仓对做空不给分——方向必须对上", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 50_000;
    const bars = FLAT.slice();
    bars[46] = hammer(46);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "short")).toBeLessThan(2);
  });

  it("空头爆仓放量 + 长上影回落 → 做空高分", () => {
    const shorts = Array(48).fill(1000);
    shorts[46] = 50_000;
    const bars = FLAT.slice();
    bars[46] = shootingStar(46);
    expect(sweepScore(liqSeries(Array(48).fill(1000), shorts), bars, "short")).toBeGreaterThan(14);
  });

  it("有爆仓峰值但价格没收回时只拿到峰值分，拿不到确认分", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 50_000;
    const noRecover = FLAT.slice();
    // 收在最低点附近 = 没有收回
    noRecover[46] = { time: 46, open: "100", high: "100.2", low: "90", close: "90.1", volume_usd: "1000" };
    const score = sweepScore(liqSeries(longs, Array(48).fill(1000)), noRecover, "long");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(12);
  });

  it("峰值发生在两小时之前不算数——sweep 是个短命事件", () => {
    const longs = Array(48).fill(1000);
    longs[10] = 50_000;
    const bars = FLAT.slice();
    bars[10] = hammer(10);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "long")).toBeLessThan(2);
  });

  it("低于起分线的峰值不给分", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 1000 * (SWEEP_SPIKE_MIN - 0.5);
    const bars = FLAT.slice();
    bars[46] = hammer(46);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "long")).toBeLessThan(8);
  });

  it("分数恒在 [0, 20]", () => {
    const longs = Array(48).fill(1);
    longs[47] = 10_000_000;
    const bars = FLAT.slice();
    bars[47] = hammer(47);
    const v = sweepScore(liqSeries(longs, Array(48).fill(1)), bars, "long");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(20);
  });
});
