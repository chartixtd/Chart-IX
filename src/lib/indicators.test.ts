import { describe, it, expect } from "vitest";
import { computeKDJ, computeStochRSI, computeAwesomeOscillator } from "./indicators";

describe("computeKDJ", () => {
  const highs = [10, 11, 12, 11, 10, 9, 10, 11, 12, 13, 12, 11];
  const lows = [8, 9, 10, 9, 8, 7, 8, 9, 10, 11, 10, 9];
  const closes = [9, 10, 11, 10, 9, 8, 9, 10, 11, 12, 11, 10];

  it("returns null for k/d/j before the warm-up period completes", () => {
    const { k, d, j } = computeKDJ(highs, lows, closes, 9, 3, 3);
    expect(k[7]).toBeNull();
    expect(d[7]).toBeNull();
    expect(j[7]).toBeNull();
  });

  it("produces a finite K value once `period` bars are available", () => {
    const { k } = computeKDJ(highs, lows, closes, 9, 3, 3);
    expect(k[8]).not.toBeNull();
    expect(Number.isFinite(k[8])).toBe(true);
  });

  it("computes J as 3K - 2D once both are available", () => {
    const { k, d, j } = computeKDJ(highs, lows, closes, 9, 3, 3);
    const lastIdx = closes.length - 1;
    if (k[lastIdx] !== null && d[lastIdx] !== null) {
      expect(j[lastIdx]).toBeCloseTo(3 * k[lastIdx]! - 2 * d[lastIdx]!, 6);
    }
  });
});

describe("computeStochRSI", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2);

  it("stays null until rsiPeriod + stochPeriod bars have accumulated", () => {
    const { k } = computeStochRSI(closes, 14, 14, 3, 3);
    expect(k[20]).toBeNull();
  });

  it("produces K values within [0, 100] once warmed up", () => {
    const { k, d } = computeStochRSI(closes, 14, 14, 3, 3);
    for (let i = 30; i < closes.length; i++) {
      if (k[i] !== null) {
        expect(k[i]!).toBeGreaterThanOrEqual(0);
        expect(k[i]!).toBeLessThanOrEqual(100);
      }
      if (d[i] !== null) {
        expect(d[i]!).toBeGreaterThanOrEqual(0);
        expect(d[i]!).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("computeAwesomeOscillator", () => {
  const highs = Array.from({ length: 50 }, (_, i) => 105 + Math.sin(i / 4) * 8 + i * 0.1);
  const lows = Array.from({ length: 50 }, (_, i) => 95 + Math.sin(i / 4) * 8 + i * 0.1);

  it("stays null before slowPeriod bars have accumulated", () => {
    const ao = computeAwesomeOscillator(highs, lows, 5, 34);
    expect(ao[10]).toBeNull();
  });

  it("produces a finite value once slowPeriod bars are available", () => {
    const ao = computeAwesomeOscillator(highs, lows, 5, 34);
    expect(ao[40]).not.toBeNull();
    expect(Number.isFinite(ao[40])).toBe(true);
  });
});
