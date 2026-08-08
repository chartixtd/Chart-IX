import { describe, it, expect } from "vitest";
import {
  mergeOlderKlines,
  determineHasMore,
  computeNextEndTime,
  windowsAreContiguous,
  intervalToMs,
} from "./kline-history";
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

  it("keeps candles that slid out of the latest window (no hole)", () => {
    const k = (t: number): BingXKline => ({
      openTime: t,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      closeTime: t + 999,
      quoteVolume: 1,
    });
    const older = [k(1), k(2), k(3)];
    const latestBefore = [k(4), k(5), k(6)];
    const merged1 = mergeOlderKlines(older, latestBefore);
    expect(merged1.map((c) => c.openTime)).toEqual([1, 2, 3, 4, 5, 6]);

    // 窗口前移一根：k(4) 滑出 latest，若不保留就会出现空洞
    const latestAfter = [k(5), k(6), k(7)];
    const merged2 = mergeOlderKlines(merged1, latestAfter);
    expect(merged2.map((c) => c.openTime)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("latest page wins on overlapping timestamps (closed candle final values)", () => {
    const a: BingXKline = { openTime: 10, open: 1, high: 1, low: 1, close: 1, volume: 1, closeTime: 1009, quoteVolume: 1 };
    const b: BingXKline = { openTime: 10, open: 9, high: 9, low: 9, close: 9, volume: 9, closeTime: 1009, quoteVolume: 9 };
    const merged = mergeOlderKlines([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].close).toBe(9);
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

describe("intervalToMs", () => {
  it("maps known interval strings to their millisecond duration", () => {
    expect(intervalToMs("1m")).toBe(60_000);
    expect(intervalToMs("1h")).toBe(3_600_000);
    expect(intervalToMs("1d")).toBe(86_400_000);
  });

  it("falls back to 1 hour for an unrecognized interval", () => {
    expect(intervalToMs("bogus")).toBe(3_600_000);
  });
});

describe("windowsAreContiguous", () => {
  const oneMinute = 60_000;

  it("is true when the two windows overlap", () => {
    expect(windowsAreContiguous(1_000_000, 940_000, oneMinute)).toBe(true);
  });

  it("is true when the newer window starts exactly one interval after the older window's max", () => {
    expect(windowsAreContiguous(1_000_000, 1_060_000, oneMinute)).toBe(true);
  });

  it("is false when there is a gap of more than one interval between windows", () => {
    expect(windowsAreContiguous(1_000_000, 1_120_001, oneMinute)).toBe(false);
  });

  it("is true when the 'newer' window is actually earlier (older data re-fetched)", () => {
    expect(windowsAreContiguous(1_000_000, 100_000, oneMinute)).toBe(true);
  });
});
