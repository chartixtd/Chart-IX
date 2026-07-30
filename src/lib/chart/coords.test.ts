import { describe, it, expect } from "vitest";
import { timeToLogical, logicalToTime, snapToBar } from "./coords";

const STEP = 3600;
// 50 hourly bars starting at an arbitrary epoch
const times = Array.from({ length: 50 }, (_, i) => 1_700_000_000 + i * STEP);

describe("timeToLogical", () => {
  it("maps bar times to their exact index", () => {
    // toBeCloseTo, not toBe: the first-bar branch yields -0, which is
    // arithmetically identical to 0 for every downstream use.
    expect(timeToLogical(times, times[0])).toBeCloseTo(0, 9);
    expect(timeToLogical(times, times[17])).toBeCloseTo(17, 9);
    expect(timeToLogical(times, times[49])).toBeCloseTo(49, 9);
  });

  it("interpolates between bars", () => {
    expect(timeToLogical(times, times[10] + STEP / 2)).toBeCloseTo(10.5, 9);
    expect(timeToLogical(times, times[10] + STEP / 4)).toBeCloseTo(10.25, 9);
  });

  it("extrapolates before the first bar as negative logicals", () => {
    expect(timeToLogical(times, times[0] - STEP)).toBeCloseTo(-1, 9);
    expect(timeToLogical(times, times[0] - STEP * 3)).toBeCloseTo(-3, 9);
  });

  it("extrapolates past the last bar", () => {
    expect(timeToLogical(times, times[49] + STEP * 2)).toBeCloseTo(51, 9);
  });

  it("handles degenerate inputs without throwing", () => {
    expect(timeToLogical([], 123)).toBe(0);
    expect(timeToLogical([500], 123)).toBe(0);
  });
});

describe("logicalToTime", () => {
  it("round-trips with timeToLogical for in-range times", () => {
    for (const i of [0, 1, 13, 30, 49]) {
      expect(logicalToTime(times, timeToLogical(times, times[i]))).toBe(times[i]);
    }
  });

  it("round-trips for interpolated times", () => {
    const t = times[20] + STEP / 3;
    expect(logicalToTime(times, timeToLogical(times, t))).toBe(Math.round(t));
  });

  it("round-trips beyond both ends, so a shape dragged off-data keeps its anchor", () => {
    for (const t of [times[0] - STEP * 5, times[49] + STEP * 8]) {
      expect(logicalToTime(times, timeToLogical(times, t))).toBe(t);
    }
  });
});

describe("snapToBar", () => {
  it("snaps to the nearest bar inside the range", () => {
    expect(snapToBar(times, times[10] + STEP * 0.4)).toBe(times[10]);
    expect(snapToBar(times, times[10] + STEP * 0.6)).toBe(times[11]);
    expect(snapToBar(times, times[10])).toBe(times[10]);
  });

  it("leaves out-of-range times alone rather than clamping onto the edge bar", () => {
    // Clamping would yank a shape anchored in the future back onto the last candle.
    const future = times[49] + STEP * 4;
    expect(snapToBar(times, future)).toBe(future);
    const past = times[0] - STEP * 4;
    expect(snapToBar(times, past)).toBe(past);
  });

  it("is idempotent", () => {
    const once = snapToBar(times, times[7] + 900);
    expect(snapToBar(times, once)).toBe(once);
  });

  it("returns the input when there are no bars", () => {
    expect(snapToBar([], 999)).toBe(999);
  });
});
