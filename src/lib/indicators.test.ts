import { describe, it, expect } from "vitest";
import { computeKDJ, computeStochRSI, computeAwesomeOscillator, computeHullMA, computePivotPoints } from "./indicators";

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

describe("computeHullMA", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);

  it("stays null before enough bars for the full WMA(sqrt(period)) chain", () => {
    const hma = computeHullMA(closes, 9);
    expect(hma[2]).toBeNull();
  });

  it("tracks a steadily rising series with a rising value", () => {
    const hma = computeHullMA(closes, 9);
    const last = hma[closes.length - 1];
    const prior = hma[closes.length - 5];
    expect(last).not.toBeNull();
    expect(prior).not.toBeNull();
    expect(last!).toBeGreaterThan(prior!);
  });
});

import { computeAlligator } from "./indicators";

describe("computeAlligator", () => {
  const highs = Array.from({ length: 60 }, (_, i) => 105 + Math.sin(i / 6) * 5 + i * 0.1);
  const lows = Array.from({ length: 60 }, (_, i) => 95 + Math.sin(i / 6) * 5 + i * 0.1);

  it("shifts each line forward by its own shift amount (nulls at the start)", () => {
    const { jaw, lips } = computeAlligator(highs, lows, 13, 8, 8, 5, 5, 3);
    // lips (shift 3) should have a value strictly before jaw (shift 8) does
    const firstLipsIdx = lips.findIndex((v) => v !== null);
    const firstJawIdx = jaw.findIndex((v) => v !== null);
    expect(firstLipsIdx).toBeGreaterThan(-1);
    expect(firstJawIdx).toBeGreaterThan(-1);
    expect(firstLipsIdx).toBeLessThan(firstJawIdx);
  });

  it("produces finite values once all three lines are warmed up", () => {
    const { jaw, teeth, lips } = computeAlligator(highs, lows, 13, 8, 8, 5, 5, 3);
    const lastIdx = highs.length - 1;
    expect(jaw[lastIdx]).not.toBeNull();
    expect(teeth[lastIdx]).not.toBeNull();
    expect(lips[lastIdx]).not.toBeNull();
  });
});

describe("computePivotPoints", () => {
  const highs = [12, 13, 14, 13];
  const lows = [8, 9, 10, 9];
  const closes = [10, 11, 12, 11];

  it("has no pivot for the first bar (no prior bar to derive it from)", () => {
    const { pivot } = computePivotPoints(highs, lows, closes);
    expect(pivot[0]).toBeNull();
  });

  it("computes pivot = (prevHigh + prevLow + prevClose) / 3", () => {
    const { pivot } = computePivotPoints(highs, lows, closes);
    expect(pivot[1]).toBeCloseTo((12 + 8 + 10) / 3, 6);
  });

  it("computes R1/S1 symmetric around the pivot using the prior range", () => {
    const { pivot, r1, s1 } = computePivotPoints(highs, lows, closes);
    const p = pivot[1]!;
    expect(r1[1]).toBeCloseTo(2 * p - lows[0], 6);
    expect(s1[1]).toBeCloseTo(2 * p - highs[0], 6);
  });
});

import { computeChaikinOscillator } from "./indicators";

describe("computeChaikinOscillator", () => {
  const n = 40;
  const highs = Array.from({ length: n }, (_, i) => 105 + i * 0.3);
  const lows = Array.from({ length: n }, (_, i) => 95 + i * 0.3);
  const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.3 + (i % 2 === 0 ? 2 : -2));
  const volumes = Array.from({ length: n }, () => 1000);

  it("stays null before slowPeriod bars have accumulated", () => {
    const osc = computeChaikinOscillator(highs, lows, closes, volumes, 3, 10);
    expect(osc[2]).toBeNull();
  });

  it("produces a finite value once warmed up", () => {
    const osc = computeChaikinOscillator(highs, lows, closes, volumes, 3, 10);
    expect(osc[n - 1]).not.toBeNull();
    expect(Number.isFinite(osc[n - 1])).toBe(true);
  });

  it("handles a zero high-low range bar without producing NaN (division guard)", () => {
    const flatHighs = [...highs]; flatHighs[5] = lows[5]; // high === low on bar 5
    const osc = computeChaikinOscillator(flatHighs, lows, closes, volumes, 3, 10);
    for (const v of osc) expect(Number.isNaN(v as number)).toBe(false);
  });
});

import { computeVortex } from "./indicators";

describe("computeVortex", () => {
  const n = 40;
  const highs = Array.from({ length: n }, (_, i) => 105 + Math.sin(i / 5) * 4 + i * 0.15);
  const lows = Array.from({ length: n }, (_, i) => 95 + Math.sin(i / 5) * 4 + i * 0.15);
  const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 5) * 4 + i * 0.15);

  it("stays null before period bars have accumulated", () => {
    const { viPlus, viMinus } = computeVortex(highs, lows, closes, 14);
    expect(viPlus[5]).toBeNull();
    expect(viMinus[5]).toBeNull();
  });

  it("produces positive finite values once warmed up (VI+/VI- are always >= 0)", () => {
    const { viPlus, viMinus } = computeVortex(highs, lows, closes, 14);
    for (let i = 20; i < n; i++) {
      expect(viPlus[i]).not.toBeNull();
      expect(viPlus[i]!).toBeGreaterThanOrEqual(0);
      expect(viMinus[i]!).toBeGreaterThanOrEqual(0);
    }
  });
});
