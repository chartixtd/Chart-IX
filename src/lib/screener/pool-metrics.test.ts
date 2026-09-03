import { describe, it, expect } from "vitest";
import { compressionRatio, volumeRatio, BARS_24H, BARS_6H, VOLUME_RATIO_MIN } from "./pool-metrics";

/** n 根 [high, low] 都一样的 K 线 */
const flat = (n: number, high: number, low: number, quoteVolume = 100) =>
  Array.from({ length: n }, () => ({ high, low, quoteVolume }));

describe("compressionRatio", () => {
  it("最近 6 小时缩得越窄，比值越小", () => {
    // 前 36 根在 [100,130]（振幅 30%），最后 12 根缩在 [100,103]（振幅 3%）
    const bars = [
      ...flat(BARS_24H - BARS_6H, 130, 100),
      ...flat(BARS_6H, 103, 100),
    ];
    // 24h 振幅仍是 30%（包含前面那段），6h 是 3% → 0.1
    expect(compressionRatio(bars)!).toBeCloseTo(0.1, 6);
  });

  it("全程一个区间 = 比值 1", () => {
    expect(compressionRatio(flat(BARS_24H, 110, 100))!).toBeCloseTo(1, 6);
  });

  it("24h 振幅只由最后 48 根决定，更早的不算", () => {
    // 前面塞一段巨大振幅，它在 24h 窗口之外，不该影响结果
    const bars = [...flat(50, 1000, 100), ...flat(BARS_24H, 110, 100)];
    expect(compressionRatio(bars)!).toBeCloseTo(1, 6);
  });

  it("根数不足 48 返回 null——凑不出 24 小时就没有分母", () => {
    expect(compressionRatio(flat(BARS_24H - 1, 110, 100))).toBeNull();
  });

  it("24h 一动不动返回 null，不是 0", () => {
    // 「压缩到极致」和「这个标的根本没交易」必须分开：后者排到榜首是错的。
    expect(compressionRatio(flat(BARS_24H, 100, 100))).toBeNull();
  });

  it("价格非法不误算", () => {
    const bars = flat(BARS_24H, NaN, NaN);
    expect(compressionRatio(bars)).toBeNull();
  });

  it("最低价为 0 时返回 null 而不是 Infinity", () => {
    expect(compressionRatio(flat(BARS_24H, 100, 0))).toBeNull();
  });
});

describe("volumeRatio", () => {
  /** days 天的 K 线，最后一天每根的成交额换成 recent */
  const series = (days: number, base: number, recent: number) => {
    const n = days * BARS_24H;
    return Array.from({ length: n }, (_, i) => ({
      high: 110,
      low: 100,
      quoteVolume: i >= n - BARS_24H ? recent : base,
    }));
  };

  it("每天量都一样时比值是 1", () => {
    expect(volumeRatio(series(14, 100, 100))!).toBeCloseTo(1, 6);
  });

  it("最近 24 小时萎缩 = 比值 < 门槛，这正是要挡的那种币", () => {
    // 平时每根 500、今天只有 50
    expect(volumeRatio(series(14, 500, 50))!).toBeLessThan(VOLUME_RATIO_MIN);
  });

  it("最近 24 小时放量 = 比值 > 1", () => {
    expect(volumeRatio(series(14, 100, 400))!).toBeGreaterThan(1);
  });

  it("日均按实际根数折算，序列长短不该把比值算成另一个东西", () => {
    const a = volumeRatio(series(7, 100, 400))!;
    const b = volumeRatio(series(14, 100, 400))!;
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it("不足两天的样本返回 null", () => {
    expect(volumeRatio(series(1, 100, 100))).toBeNull();
  });

  it("有一根坏数据就返回 null，不用残缺的和去除", () => {
    const s = series(14, 100, 100);
    s[10] = { ...s[10], quoteVolume: NaN };
    expect(volumeRatio(s)).toBeNull();
  });

  it("总量为 0 时返回 null 而不是 Infinity", () => {
    expect(volumeRatio(series(14, 0, 0))).toBeNull();
  });
});
