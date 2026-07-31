import { describe, it, expect } from "vitest";
import { mergeOlderKlines, determineHasMore, computeNextEndTime } from "./kline-history";
import type { BingXKline } from "@/types/bingx";

function kline(openTime: number): BingXKline {
  return {
    openTime,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    closeTime: openTime + 999,
    quoteVolume: 15,
  };
}

describe("mergeOlderKlines", () => {
  it("combines two non-overlapping batches into ascending openTime order", () => {
    const older = [kline(1000), kline(2000)];
    const existing = [kline(3000), kline(4000)];
    expect(mergeOlderKlines(older, existing).map((k) => k.openTime)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("de-duplicates a shared boundary candle instead of keeping two entries for the same openTime", () => {
    const older = [kline(1000), kline(2000), kline(3000)];
    const existing = [kline(3000), kline(4000)];
    const merged = mergeOlderKlines(older, existing);
    expect(merged.map((k) => k.openTime)).toEqual([1000, 2000, 3000, 4000]);
    expect(merged).toHaveLength(4);
  });

  it("works regardless of input order (unsorted inputs still come out ascending)", () => {
    const older = [kline(2000), kline(1000)];
    const existing = [kline(4000), kline(3000)];
    expect(mergeOlderKlines(older, existing).map((k) => k.openTime)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(mergeOlderKlines([], [])).toEqual([]);
  });
});

describe("determineHasMore", () => {
  it("is true when a full page was returned", () => {
    expect(determineHasMore(300, 300)).toBe(true);
  });

  it("is false when fewer rows than requested came back (history exhausted)", () => {
    expect(determineHasMore(47, 300)).toBe(false);
  });

  it("is false when nothing came back", () => {
    expect(determineHasMore(0, 300)).toBe(false);
  });
});

describe("computeNextEndTime", () => {
  it("is one millisecond before the earliest loaded candle", () => {
    expect(computeNextEndTime(1700000000000)).toBe(1699999999999);
  });
});
