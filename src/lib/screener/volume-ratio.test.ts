import { describe, it, expect } from "vitest";
import { volumeRatio, VOLUME_RECENT_BARS, VOLUME_RATIO_MIN } from "./volume-ratio";
import type { CoinGlassTakerBar } from "@/lib/coinglass/types";

/** 每根买卖各一半，总量由调用方给 */
function taker(volumes: number[]): CoinGlassTakerBar[] {
  return volumes.map((v, i) => ({
    time: i * 1_800_000,
    aggregated_buy_volume_usd: String(v / 2),
    aggregated_sell_volume_usd: String(v / 2),
  }));
}

/** days 天的序列，最后一天的每根量换成 recent */
function series(days: number, base: number, recent: number): CoinGlassTakerBar[] {
  const n = days * VOLUME_RECENT_BARS;
  return taker(
    Array.from({ length: n }, (_, i) => (i >= n - VOLUME_RECENT_BARS ? recent : base))
  );
}

describe("volumeRatio", () => {
  it("每天量都一样时比值是 1", () => {
    expect(volumeRatio(series(7, 100, 100))!).toBeCloseTo(1, 6);
  });

  it("最近 24 小时放量 = 比值 > 1", () => {
    // 7 天里前 6 天每根 100、最后一天每根 400：
    // 日均 = (6×100 + 400) × 48 / 7 / 48 = 142.86，比值 = 400 / 142.86 = 2.8
    expect(volumeRatio(series(7, 100, 400))!).toBeCloseTo(2.8, 1);
  });

  it("最近 24 小时萎缩 = 比值 < 1，这正是要挡的那种币", () => {
    // 平时每根 500、今天只有 50：日均 435.7，比值 0.115
    const r = volumeRatio(series(7, 500, 50))!;
    expect(r).toBeLessThan(VOLUME_RATIO_MIN);
    expect(r).toBeCloseTo(0.115, 2);
  });

  it("日均按实际根数折算，序列变长比值不该跟着变", () => {
    // 同样是「平时 100、今天 400」，7 天和 14 天算出来的比值必须接近——
    // 分母写死天数的话，序列一变长比值就会静默变成另一个东西。
    const a = volumeRatio(series(7, 100, 400))!;
    const b = volumeRatio(series(14, 100, 400))!;
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(1);
    expect(Math.abs(a - b)).toBeLessThan(1); // 同一个量级，不是差出一个 2 倍
  });

  it("不足两天的样本返回 null——算不出有意义的日均", () => {
    expect(volumeRatio(taker(Array(VOLUME_RECENT_BARS).fill(100)))).toBeNull();
  });

  it("空序列返回 null", () => {
    expect(volumeRatio([])).toBeNull();
  });

  it("有一根坏数据就返回 null，不用残缺的和去除", () => {
    const s = series(7, 100, 100);
    s[10] = { ...s[10], aggregated_buy_volume_usd: "abc" };
    expect(volumeRatio(s)).toBeNull();
  });

  it("总量为 0 时返回 null 而不是 Infinity", () => {
    expect(volumeRatio(series(7, 0, 0))).toBeNull();
  });
});
