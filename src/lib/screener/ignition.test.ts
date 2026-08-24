import { describe, it, expect } from "vitest";
import { detectIgnition, IGNITION_LOOKBACK_BARS } from "./ignition";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

/** [high, low, close] → K 线 */
function bars(specs: Array<[number, number, number]>): CoinGlassPriceBar[] {
  return specs.map(([high, low, close], i) => ({
    time: i * 1_800_000,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(close),
    volume_usd: "1",
  }));
}

/** N 根在 [100,110] 区间内震荡的 K 线，再接一根由调用方指定的 */
function withHistory(last: [number, number, number], n = IGNITION_LOOKBACK_BARS) {
  return bars([...Array.from({ length: n }, () => [110, 100, 105] as [number, number, number]), last]);
}

describe("detectIgnition", () => {
  it("收盘越过前 6 小时高点 = 向上点火，失效位就是那个高点", () => {
    expect(detectIgnition(withHistory([115, 108, 112]))).toEqual({
      direction: "up",
      level: 110,
      distancePct: expect.closeTo(1.818, 2),
    });
  });

  it("收盘跌破前 6 小时低点 = 向下点火", () => {
    const r = detectIgnition(withHistory([102, 95, 98]))!;
    expect(r.direction).toBe("down");
    expect(r.level).toBe(100);
  });

  it("还在区间里 = 没点火", () => {
    expect(detectIgnition(withHistory([109, 101, 105]))).toBeNull();
  });

  it("影线穿了但收回来 = 不算点火", () => {
    // 这是最典型的假突破：最高价 120 远超前高 110，但收盘 105 还在区间里。
    // 点火刻意用收盘价而不是最高价，就是为了挡掉它——跟失效判定用区间
    // 极值（插针也算数）是相反的口径，因为两者要防的错误相反：
    // 失效怕漏判，点火怕误判。
    expect(detectIgnition(withHistory([120, 101, 105]))).toBeNull();
  });

  it("恰好等于边界不算突破", () => {
    expect(detectIgnition(withHistory([112, 105, 110]))).toBeNull();
  });

  it("比较区间不含当前这根——否则永远突破不了", () => {
    // 当前根自己的 high=115 是区间内最高，如果把它算进比较区间，
    // close=112 就永远不可能 > high，点火恒为 null。
    expect(detectIgnition(withHistory([115, 108, 112]))).not.toBeNull();
  });

  it("K 线不够回看窗口时返回 null", () => {
    expect(detectIgnition(withHistory([115, 108, 112], 5))).toBeNull();
  });

  it("非法价格不误判成点火", () => {
    const b = withHistory([115, 108, 112]);
    b[b.length - 1] = { ...b[b.length - 1], close: "abc" };
    expect(detectIgnition(b)).toBeNull();
  });
});
