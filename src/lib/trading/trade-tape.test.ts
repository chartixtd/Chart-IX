import { describe, it, expect } from "vitest";
import { markLargeTrades } from "./trade-tape";
import type { BingXTrade } from "@/types/bingx";

function trade(qty: string, id = "1"): BingXTrade {
  return { id, price: "100", qty, time: Date.now(), isBuyerMaker: false };
}

describe("markLargeTrades", () => {
  it("marks nothing below the minimum sample size", () => {
    // 9 笔，全部低于 MIN_SAMPLE_SIZE=10 —— 即使有一笔数量是其余的 100 倍也不该标记
    const trades = [
      ...Array.from({ length: 8 }, () => trade("1")),
      trade("1000"),
    ];
    const result = markLargeTrades(trades);
    expect(result.every((t) => !t.isLarge)).toBe(true);
  });

  it("marks a trade at >= 3x the median once sample size is sufficient", () => {
    // 10 笔：9 笔数量为 1（中位数=1），1 笔数量为 3（恰好 3 倍，应标记）
    const trades = [
      ...Array.from({ length: 9 }, () => trade("1")),
      trade("3", "large"),
    ];
    const result = markLargeTrades(trades);
    const large = result.find((t) => t.id === "large");
    expect(large?.isLarge).toBe(true);
    expect(result.filter((t) => t.isLarge)).toHaveLength(1);
  });

  it("does not mark a trade just under the threshold", () => {
    const trades = [
      ...Array.from({ length: 9 }, () => trade("1")),
      trade("2.99", "not-large"),
    ];
    const result = markLargeTrades(trades);
    expect(result.find((t) => t.id === "not-large")?.isLarge).toBe(false);
  });

  it("marks nothing when all quantities are equal", () => {
    const trades = Array.from({ length: 20 }, () => trade("5"));
    const result = markLargeTrades(trades);
    expect(result.every((t) => !t.isLarge)).toBe(true);
  });

  it("ignores zero, negative, and NaN quantities when computing the median", () => {
    // 有效样本仍是 10 笔"1"——脏数据不能拉低中位数导致误判
    const trades = [
      ...Array.from({ length: 10 }, () => trade("1")),
      trade("0"),
      trade("-5"),
      trade("not-a-number"),
    ];
    const result = markLargeTrades(trades);
    const dirty = result.filter((t) => ["0", "-5", "not-a-number"].includes(t.qty));
    expect(dirty.every((t) => !t.isLarge)).toBe(true);
  });

  it("preserves input order and length", () => {
    const trades = Array.from({ length: 12 }, (_, i) => trade(String(i + 1), String(i)));
    const result = markLargeTrades(trades);
    expect(result).toHaveLength(trades.length);
    expect(result.map((t) => t.id)).toEqual(trades.map((t) => t.id));
  });

  it("handles an empty list", () => {
    expect(markLargeTrades([])).toEqual([]);
  });
});
