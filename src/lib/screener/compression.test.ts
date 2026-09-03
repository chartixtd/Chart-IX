import { describe, it, expect } from "vitest";
import { compressionRatio, COMPRESSION_BARS_24H, COMPRESSION_BARS_6H } from "./compression";

/** n 根 [high, low] 都一样的 K 线 */
const flat = (n: number, high: number, low: number) => Array.from({ length: n }, () => ({ high, low }));

describe("compressionRatio", () => {
  it("最近 6 小时缩得越窄，比值越小", () => {
    // 前 36 根在 [100,130]（振幅 30%），最后 12 根缩在 [100,103]（振幅 3%）
    const bars = [
      ...flat(COMPRESSION_BARS_24H - COMPRESSION_BARS_6H, 130, 100),
      ...flat(COMPRESSION_BARS_6H, 103, 100),
    ];
    // 24h 振幅仍是 30%（包含前面那段），6h 是 3% → 0.1
    expect(compressionRatio(bars)!).toBeCloseTo(0.1, 6);
  });

  it("全程一个区间 = 比值 1", () => {
    expect(compressionRatio(flat(COMPRESSION_BARS_24H, 110, 100))!).toBeCloseTo(1, 6);
  });

  it("24h 振幅只由最后 48 根决定，更早的不算", () => {
    // 前面塞一段巨大振幅，它在 24h 窗口之外，不该影响结果
    const bars = [...flat(50, 1000, 100), ...flat(COMPRESSION_BARS_24H, 110, 100)];
    expect(compressionRatio(bars)!).toBeCloseTo(1, 6);
  });

  it("根数不足 48 返回 null——凑不出 24 小时就没有分母", () => {
    expect(compressionRatio(flat(COMPRESSION_BARS_24H - 1, 110, 100))).toBeNull();
  });

  it("24h 一动不动返回 null，不是 0", () => {
    // 「压缩到极致」和「这个标的根本没交易」必须分开：后者排到榜首是错的。
    expect(compressionRatio(flat(COMPRESSION_BARS_24H, 100, 100))).toBeNull();
  });

  it("价格非法不误算", () => {
    const bars = flat(COMPRESSION_BARS_24H, NaN, NaN);
    expect(compressionRatio(bars)).toBeNull();
  });

  it("最低价为 0 时返回 null 而不是 Infinity", () => {
    expect(compressionRatio(flat(COMPRESSION_BARS_24H, 100, 0))).toBeNull();
  });
});
