import { describe, it, expect } from "vitest";
import { trimDepth, symbolFromDepthChannel } from "./depth";

// 实测的真实排序：asks 降序（最优/最低价在末尾）、bids 降序（最优/最高价在开头）
const book = {
  asks: [["105", "1"], ["104", "1"], ["103", "1"], ["102", "1"], ["101", "1"]] as [string, string][],
  bids: [["100", "1"], ["99", "1"], ["98", "1"], ["97", "1"], ["96", "1"]] as [string, string][],
};

describe("trimDepth", () => {
  it("keeps the BEST asks (tail) — not the worst (head)", () => {
    expect(trimDepth(book, 2).asks).toEqual([["102", "1"], ["101", "1"]]);
  });
  it("keeps the best bids (head)", () => {
    expect(trimDepth(book, 2).bids).toEqual([["100", "1"], ["99", "1"]]);
  });
  it("preserves REST ordering convention (asks descending, best last)", () => {
    const t = trimDepth(book, 3);
    expect(Number(t.asks[0][0])).toBeGreaterThan(Number(t.asks[t.asks.length - 1][0]));
    expect(Number(t.bids[0][0])).toBeGreaterThan(Number(t.bids[t.bids.length - 1][0]));
  });
  it("best ask stays above best bid after trimming", () => {
    const t = trimDepth(book, 2);
    expect(Number(t.asks[t.asks.length - 1][0])).toBeGreaterThan(Number(t.bids[0][0]));
  });
  it("returns as-is when fewer levels than limit", () => {
    expect(trimDepth(book, 99)).toEqual(book);
  });
  it("handles empty book", () => {
    expect(trimDepth({ asks: [], bids: [] }, 5)).toEqual({ asks: [], bids: [] });
  });
  it("limit 0 yields empty sides", () => {
    expect(trimDepth(book, 0)).toEqual({ asks: [], bids: [] });
  });
});

describe("symbolFromDepthChannel", () => {
  const SUFFIX = "@depth20";

  it("extracts the symbol from a depth20 dataType", () => {
    expect(symbolFromDepthChannel("BTC-USDT@depth20", SUFFIX)).toBe("BTC-USDT");
  });
  it("works for a different symbol", () => {
    expect(symbolFromDepthChannel("ETH-USDT@depth20", SUFFIX)).toBe("ETH-USDT");
  });
  it("returns null for a non-matching channel suffix", () => {
    expect(symbolFromDepthChannel("BTC-USDT@ticker", SUFFIX)).toBeNull();
  });
  it("returns null when there is no symbol before the suffix", () => {
    expect(symbolFromDepthChannel("@depth20", SUFFIX)).toBeNull();
  });
});
