import { describe, it, expect } from "vitest";
import {
  alignOhlcToTimes,
  buildExternalInput,
  cvdCandlesFromFlow,
  emptyCandles,
  externalSeriesTtlMs,
  isCandlePoint,
  isExternalIntervalSupported,
  isExternalKind,
  isValidExternalCoin,
  EXTERNAL_SERIES_INTERVALS,
} from "./external-series";

const H = 3600;

describe("interval / kind / coin validation", () => {
  it("accepts exactly the STARTUP whitelist and nothing finer", () => {
    for (const i of EXTERNAL_SERIES_INTERVALS) expect(isExternalIntervalSupported(i)).toBe(true);
    for (const i of ["1m", "3m", "5m", "15m", "3d", "", "30"]) {
      expect(isExternalIntervalSupported(i), i).toBe(false);
    }
  });

  it("recognises the two kinds only", () => {
    expect(isExternalKind("oi")).toBe(true);
    expect(isExternalKind("cvd")).toBe(true);
    expect(isExternalKind("funding")).toBe(false);
    expect(isExternalKind("")).toBe(false);
  });

  it("only lets uppercase alphanumerics through as a coin", () => {
    expect(isValidExternalCoin("BTC")).toBe(true);
    expect(isValidExternalCoin("1000PEPE")).toBe(true);
    expect(isValidExternalCoin("btc")).toBe(false);
    expect(isValidExternalCoin("BTC-USDT")).toBe(false);
    expect(isValidExternalCoin("BTC&exchange=x")).toBe(false);
    expect(isValidExternalCoin("")).toBe(false);
  });
});

describe("externalSeriesTtlMs", () => {
  it("floors at 5 minutes for the finest supported interval", () => {
    expect(externalSeriesTtlMs("30m")).toBe(5 * 60_000);
  });

  it("scales with the interval and caps at 4 hours", () => {
    expect(externalSeriesTtlMs("1h")).toBe(10 * 60_000);
    expect(externalSeriesTtlMs("4h")).toBe(40 * 60_000);
    expect(externalSeriesTtlMs("1d")).toBe(4 * 60 * 60_000);
    expect(externalSeriesTtlMs("1w")).toBe(4 * 60 * 60_000);
  });
});

describe("cvdCandlesFromFlow", () => {
  it("accumulates net taker flow from zero, open = previous close", () => {
    const out = cvdCandlesFromFlow([
      { t: 0, buy: 100, sell: 40 }, // +60
      { t: H, buy: 10, sell: 50 }, // -40
      { t: 2 * H, buy: 5, sell: 5 }, // 0
    ]);
    expect(out).toEqual([
      { t: 0, o: 0, h: 60, l: 0, c: 60 },
      { t: H, o: 60, h: 60, l: 20, c: 20 },
      { t: 2 * H, o: 20, h: 20, l: 20, c: 20 },
    ]);
  });

  it("skips bars with non-finite flow without breaking the running sum", () => {
    const out = cvdCandlesFromFlow([
      { t: 0, buy: 10, sell: 0 },
      { t: H, buy: NaN, sell: 0 },
      { t: 2 * H, buy: 0, sell: 5 },
    ]);
    expect(out.map((b) => b.t)).toEqual([0, 2 * H]);
    expect(out[1]).toEqual({ t: 2 * H, o: 10, h: 10, l: 5, c: 5 });
  });

  it("returns an empty series for empty input", () => {
    expect(cvdCandlesFromFlow([])).toEqual([]);
  });
});

describe("alignOhlcToTimes", () => {
  const bars = [
    { t: H, o: 1, h: 2, l: 0.5, c: 1.5 },
    { t: 2 * H, o: 1.5, h: 3, l: 1, c: 2 },
  ];

  it("matches on exact open time and leaves gaps as null", () => {
    const out = alignOhlcToTimes(bars, [0, H, 2 * H, 3 * H]);
    expect(out).toEqual([
      null,
      { open: 1, high: 2, low: 0.5, close: 1.5 },
      { open: 1.5, high: 3, low: 1, close: 2 },
      null,
    ]);
  });

  it("does not interpolate when the chart is on a finer grid", () => {
    // 30m chart against 1h bars: the half-hour slots stay empty.
    const out = alignOhlcToTimes(bars, [H, H + 1800, 2 * H]);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).not.toBeNull();
  });

  it("drops bars with non-finite fields", () => {
    const out = alignOhlcToTimes([{ t: H, o: 1, h: NaN, l: 0, c: 1 }], [H]);
    expect(out).toEqual([null]);
  });

  it("is the same length as the chart time array even when empty", () => {
    expect(alignOhlcToTimes([], [1, 2, 3])).toEqual([null, null, null]);
    expect(alignOhlcToTimes(bars, [])).toEqual([]);
  });
});

describe("buildExternalInput", () => {
  it("only includes the kinds present in the payload", () => {
    const times = [0, H];
    expect(buildExternalInput({}, times)).toEqual({});
    const oiOnly = buildExternalInput({ oi: [{ t: H, o: 1, h: 1, l: 1, c: 1 }] }, times);
    expect(oiOnly.oi).toHaveLength(2);
    expect(oiOnly.cvd).toBeUndefined();
  });

  it("turns flow bars into aligned CVD candles", () => {
    const ext = buildExternalInput(
      { cvd: [{ t: 0, buy: 10, sell: 0 }, { t: H, buy: 0, sell: 4 }] },
      [0, H, 2 * H]
    );
    expect(ext.cvd).toEqual([
      { open: 0, high: 10, low: 0, close: 10 },
      { open: 10, high: 10, low: 6, close: 6 },
      null,
    ]);
  });
});

describe("helpers", () => {
  it("emptyCandles is all-null at the requested length", () => {
    expect(emptyCandles(3)).toEqual([null, null, null]);
    expect(emptyCandles(0)).toEqual([]);
  });

  it("isCandlePoint distinguishes candles from numbers and null", () => {
    expect(isCandlePoint({ open: 1, high: 1, low: 1, close: 1 })).toBe(true);
    expect(isCandlePoint(1)).toBe(false);
    expect(isCandlePoint(null)).toBe(false);
    expect(isCandlePoint(undefined)).toBe(false);
  });
});
