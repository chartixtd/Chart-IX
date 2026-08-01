import { describe, it, expect } from "vitest";
import {
  INDICATORS, INDICATOR_BY_ID, defaultParams, legendLabel, resolvePlotStyle, type IndicatorInput,
} from "./indicator-registry";

/** Deterministic 200-bar OHLCV series with a trend, a cycle, and varied volume. */
function makeBars(n = 200): IndicatorInput {
  const close = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 7) * 6 + i * 0.08);
  return {
    close,
    open: close.map((c, i) => c - ((i * 13) % 7) / 7 + 0.3),
    high: close.map((c, i) => c + 0.4 + ((i * 37) % 11) / 11),
    low: close.map((c, i) => c - 0.4 - ((i * 53) % 11) / 11),
    volume: Array.from({ length: n }, (_, i) => 500 + ((i * 71) % 900)),
  };
}

const bars = makeBars();

describe("indicator registry integrity", () => {
  it("has unique ids", () => {
    const ids = INDICATORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares at least one plot per indicator", () => {
    for (const def of INDICATORS) {
      expect(def.plots.length, `${def.id} has no plots`).toBeGreaterThan(0);
    }
  });

  it("has unique plot keys within each indicator", () => {
    for (const def of INDICATORS) {
      const keys = def.plots.map((p) => p.key);
      expect(new Set(keys).size, `${def.id} has duplicate plot keys`).toBe(keys.length);
    }
  });

  it("gives every param a finite default inside its own min/max", () => {
    for (const def of INDICATORS) {
      for (const p of def.params) {
        expect(Number.isFinite(p.default), `${def.id}.${p.key} default`).toBe(true);
        if (p.min !== undefined) expect(p.default, `${def.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        if (p.max !== undefined) expect(p.default, `${def.id}.${p.key}`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("INDICATOR_BY_ID covers every definition", () => {
    expect(INDICATOR_BY_ID.size).toBe(INDICATORS.length);
    for (const def of INDICATORS) expect(INDICATOR_BY_ID.get(def.id)).toBe(def);
  });
});

describe("indicator computation contract", () => {
  // The chart looks up compute() output by plot key; a mismatch renders an
  // permanently empty series, which is invisible rather than loud. Assert it.
  it("returns a series for every declared plot key, at bar length", () => {
    for (const def of INDICATORS) {
      const out = def.compute(bars, defaultParams(def));
      for (const plot of def.plots) {
        const values = out[plot.key];
        expect(values, `${def.id} missing output for plot "${plot.key}"`).toBeDefined();
        expect(values.length, `${def.id}.${plot.key} length`).toBe(bars.close.length);
      }
    }
  });

  it("produces at least one non-null point per plot on a 200-bar series", () => {
    for (const def of INDICATORS) {
      const out = def.compute(bars, defaultParams(def));
      for (const plot of def.plots) {
        const nonNull = out[plot.key].filter((v) => v !== null && !Number.isNaN(v));
        expect(nonNull.length, `${def.id}.${plot.key} is entirely empty`).toBeGreaterThan(0);
      }
    }
  });

  it("never emits NaN or Infinity", () => {
    for (const def of INDICATORS) {
      const out = def.compute(bars, defaultParams(def));
      for (const plot of def.plots) {
        for (const v of out[plot.key]) {
          if (v === null) continue;
          expect(Number.isFinite(v), `${def.id}.${plot.key} produced ${v}`).toBe(true);
        }
      }
    }
  });

  it("survives a short series without throwing", () => {
    // Newly listed pairs can have only a handful of bars; every indicator must
    // degrade to nulls rather than crash the whole chart.
    for (const len of [0, 1, 2, 5]) {
      const short = makeBars(len);
      for (const def of INDICATORS) {
        expect(
          () => def.compute(short, defaultParams(def)),
          `${def.id} threw on ${len} bars`
        ).not.toThrow();
      }
    }
  });

  it("respects a user-edited period (output shifts when params change)", () => {
    const def = INDICATOR_BY_ID.get("ma")!;
    const fast = def.compute(bars, { period: 5 }).ma;
    const slow = def.compute(bars, { period: 50 }).ma;
    expect(fast[fast.length - 1]).not.toBe(slow[slow.length - 1]);
    // A longer period must start later.
    const firstNonNull = (a: (number | null)[]) => a.findIndex((v) => v !== null);
    expect(firstNonNull(slow)).toBeGreaterThan(firstNonNull(fast));
  });

  it("colours MACD histogram bars by sign", () => {
    const def = INDICATOR_BY_ID.get("macd")!;
    const plot = def.plots.find((p) => p.key === "hist")!;
    expect(plot.barColor).toBeDefined();
    const upColor = plot.barColor!({ i: 10, value: 1.5, input: bars });
    const downColor = plot.barColor!({ i: 10, value: -1.5, input: bars });
    expect(upColor).not.toBe(downColor);
  });

  it("colours volume bars by candle direction", () => {
    const def = INDICATOR_BY_ID.get("volume")!;
    const plot = def.plots[0];
    expect(plot.barColor).toBeDefined();
    const rising: IndicatorInput = { ...bars, open: [10], close: [11], high: [11], low: [10], volume: [5] };
    const falling: IndicatorInput = { ...bars, open: [11], close: [10], high: [11], low: [10], volume: [5] };
    expect(plot.barColor!({ i: 0, value: 5, input: rising })).not.toBe(
      plot.barColor!({ i: 0, value: 5, input: falling })
    );
  });
});

describe("legendLabel", () => {
  it("appends param values", () => {
    expect(legendLabel(INDICATOR_BY_ID.get("ma")!, { period: 20 })).toBe("MA 20");
    expect(legendLabel(INDICATOR_BY_ID.get("macd")!, { fast: 12, slow: 26, signal: 9 })).toBe(
      "MACD 12 26 9"
    );
  });

  it("omits the suffix for param-less indicators", () => {
    expect(legendLabel(INDICATOR_BY_ID.get("volume")!, {})).toBe("Vol");
    expect(legendLabel(INDICATOR_BY_ID.get("vwap")!, {})).toBe("VWAP");
  });
});

describe("resolvePlotStyle", () => {
  const maDef = INDICATOR_BY_ID.get("ma")!;
  const maPlot = maDef.plots[0];

  it("falls back to the registry's default plot color/width/style when there is no override", () => {
    const resolved = resolvePlotStyle(maDef, undefined, "ma");
    expect(resolved.color).toBe(maPlot.color);
    expect(resolved.lineWidth).toBe(maPlot.lineWidth ?? 1);
    expect(resolved.lineStyle).toBe(maPlot.lineStyle ?? 0);
  });

  it("uses the override's color when one is set for that plot key", () => {
    const resolved = resolvePlotStyle(maDef, { ma: { color: "#ff0000" } }, "ma");
    expect(resolved.color).toBe("#ff0000");
    expect(resolved.lineWidth).toBe(maPlot.lineWidth ?? 1); // unset fields still fall back
  });

  it("returns the registry default for a plot key with no matching override entry", () => {
    const resolved = resolvePlotStyle(maDef, { someOtherKey: { color: "#ff0000" } }, "ma");
    expect(resolved.color).toBe(maPlot.color);
  });
});
