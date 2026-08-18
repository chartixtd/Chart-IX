import { describe, it, expect } from "vitest";
import { buildVolumeProfile, zonePosition, zoneScore, ZONE_BREAKDOWN_ZERO_AT } from "./zone";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

/** 造一根 K 线：整根都落在 [low, high]，成交额 volume。 */
function bar(low: number, high: number, volume: number, time = 0): CoinGlassPriceBar {
  return {
    time,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(high),
    volume_usd: String(volume),
  };
}

/**
 * 一份筹码集中在 [100, 110]、两侧各有一点稀薄成交的分布。
 * 价值区应该落在中间那一坨里，VAL 接近 100、VAH 接近 110。
 */
function concentratedBars(): CoinGlassPriceBar[] {
  const bars: CoinGlassPriceBar[] = [];
  for (let i = 0; i < 40; i++) bars.push(bar(100, 110, 1000, i));
  bars.push(bar(60, 100, 5, 100));
  bars.push(bar(110, 150, 5, 101));
  return bars;
}

describe("buildVolumeProfile", () => {
  it("价值区落在筹码密集处，而不是整个价格全域", () => {
    const p = buildVolumeProfile(concentratedBars())!;
    expect(p.val).toBeGreaterThan(95);
    expect(p.vah).toBeLessThan(115);
    expect(p.poc).toBeGreaterThanOrEqual(p.val);
    expect(p.poc).toBeLessThanOrEqual(p.vah);
  });

  it("K 线不足时返回 null，让上层走中性分而不是拿一个假的价值区打分", () => {
    expect(buildVolumeProfile([bar(1, 2, 10)])).toBeNull();
    expect(buildVolumeProfile([])).toBeNull();
  });

  it("全域为零宽（所有 K 线同价）时返回 null，避免除零", () => {
    const flat = Array.from({ length: 40 }, (_, i) => bar(5, 5, 100, i));
    expect(buildVolumeProfile(flat)).toBeNull();
  });
});

describe("zonePosition", () => {
  const profile = { poc: 105, val: 100, vah: 110 };

  it("贴 VAL 是 0，贴 VAH 是 1", () => {
    expect(zonePosition(100, profile)).toBeCloseTo(0);
    expect(zonePosition(110, profile)).toBeCloseTo(1);
  });

  it("跌破 VAL 是负数，冲出 VAH 大于 1", () => {
    expect(zonePosition(95, profile)).toBeCloseTo(-0.5);
    expect(zonePosition(115, profile)).toBeCloseTo(1.5);
  });
});

describe("zoneScore 曲线拐点", () => {
  const bars = concentratedBars();
  // 用真实 profile 反推出目标 pos 对应的价格，避免测试依赖桶边界的具体取值
  const p = buildVolumeProfile(bars)!;
  const at = (pos: number) => p.val + pos * (p.vah - p.val);

  it("pos 在 [0, 0.35] 平台上给满分 30", () => {
    expect(zoneScore(at(0), bars, "long")).toBeCloseTo(30, 5);
    expect(zoneScore(at(0.35), bars, "long")).toBeCloseTo(30, 5);
  });

  it("pos = 0.7 降到 12", () => {
    expect(zoneScore(at(0.7), bars, "long")).toBeCloseTo(12, 5);
  });

  it("pos = 1.0 降到 4", () => {
    expect(zoneScore(at(1), bars, "long")).toBeCloseTo(4, 5);
  });

  it("冲出 VAH 之后固定 4 分——已离开筹码区，做多就是追高", () => {
    expect(zoneScore(at(1.5), bars, "long")).toBeCloseTo(4, 5);
    expect(zoneScore(at(5), bars, "long")).toBeCloseTo(4, 5);
  });

  it("跌破 VAL 从 30 线性衰减，到 ZONE_BREAKDOWN_ZERO_AT 归零", () => {
    expect(zoneScore(at(ZONE_BREAKDOWN_ZERO_AT / 2), bars, "long")).toBeCloseTo(15, 5);
    expect(zoneScore(at(ZONE_BREAKDOWN_ZERO_AT), bars, "long")).toBeCloseTo(0, 5);
    expect(zoneScore(at(ZONE_BREAKDOWN_ZERO_AT * 2), bars, "long")).toBeCloseTo(0, 5);
  });

  it("做空是把 pos 换成 1-pos 走同一条曲线", () => {
    expect(zoneScore(at(1), bars, "short")).toBeCloseTo(30, 5);
    expect(zoneScore(at(0.3), bars, "short")).toBeCloseTo(zoneScore(at(0.7), bars, "long"), 5);
  });

  it("数据不足时给中性 15，不给 0 也不给满分", () => {
    expect(zoneScore(100, [bar(1, 2, 10)], "long")).toBe(15);
  });

  it("分数恒在 [0, 30]", () => {
    for (const pos of [-3, -0.5, 0, 0.5, 1, 3]) {
      for (const dir of ["long", "short"] as const) {
        const v = zoneScore(at(pos), bars, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(30);
      }
    }
  });
});
