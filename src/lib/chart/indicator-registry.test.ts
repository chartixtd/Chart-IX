import { describe, it, expect } from "vitest";
import {
  INDICATORS, INDICATOR_BY_ID, defaultParams, defaultSettings, legendLabel, resolvePlotStyle, resolveCandleStyle,
  settingVisible, settingOptions, type IndicatorInput,
} from "./indicator-registry";
import { CHART } from "@/lib/chart-theme";
import { isCandlePoint, type CandlePoint } from "./external-series";

/** Indicators fed by CoinGlass (`requires`) are all-null without `input.ext`; they get their own suite below. */
const ohlcvOnly = INDICATORS.filter((d) => !d.requires?.length);

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
    for (const def of ohlcvOnly) {
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
          const nums = isCandlePoint(v) ? [v.open, v.high, v.low, v.close] : [v];
          for (const n of nums) {
            expect(Number.isFinite(n), `${def.id}.${plot.key} produced ${n}`).toBe(true);
          }
        }
      }
    }
  });

  it("declares candle plots only on indicators that also declare an external source", () => {
    for (const def of INDICATORS) {
      if (def.plots.some((p) => p.kind === "candles")) {
        expect(def.requires?.length, `${def.id} has candle plots but no requires`).toBeGreaterThan(0);
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
    const fast = def.compute(bars, { period: 5 }).ma as (number | null)[];
    const slow = def.compute(bars, { period: 50 }).ma as (number | null)[];
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

describe("CoinGlass-fed indicators", () => {
  const candle = (i: number): CandlePoint => ({ open: i, high: i + 1, low: i - 1, close: i + 0.5 });
  const series = bars.close.map((_, i) => (i < 10 ? null : candle(i)));
  const ext = { series };

  it("exist, live in the derivatives category and require their kind", () => {
    const oi = INDICATOR_BY_ID.get("cg_oi")!;
    const cvd = INDICATOR_BY_ID.get("cg_cvd")!;
    expect(oi.category).toBe("derivatives");
    expect(cvd.category).toBe("derivatives");
    expect(oi.requires).toEqual(["oi"]);
    expect(cvd.requires).toEqual(["cvd"]);
    expect(oi.source).toBe("coinglass");
    expect(oi.plots[0].kind).toBe("candles");
    expect(cvd.plots[0].kind).toBe("candles");
  });

  it("pass the instance's aligned external candles straight through", () => {
    const oi = INDICATOR_BY_ID.get("cg_oi")!.compute({ ...bars, ext }, {});
    const cvd = INDICATOR_BY_ID.get("cg_cvd")!.compute({ ...bars, ext }, {});
    expect(oi.oi).toBe(series);
    expect(cvd.cvd).toBe(series);
  });

  it("degrade to an all-null series of bar length without ext (finer interval / not loaded yet)", () => {
    for (const id of ["cg_oi", "cg_cvd"]) {
      const def = INDICATOR_BY_ID.get(id)!;
      const out = def.compute(bars, {});
      const s = out[def.plots[0].key];
      expect(s).toHaveLength(bars.close.length);
      expect(s.every((v) => v === null)).toBe(true);
      const empty = def.compute({ ...bars, ext: {} }, {});
      expect(empty[def.plots[0].key].every((v) => v === null)).toBe(true);
    }
  });

  it("have param-less legend labels, with a CoinGlass-style settings summary when settings are given", () => {
    const oi = INDICATOR_BY_ID.get("cg_oi")!;
    const cvd = INDICATOR_BY_ID.get("cg_cvd")!;
    expect(legendLabel(oi, {})).toBe("OI");
    expect(legendLabel(cvd, {})).toBe("CVD");
    expect(legendLabel(oi, {}, defaultSettings(oi))).toBe("OI 币本位 · USD · No Filter");
    expect(legendLabel(cvd, {}, defaultSettings(cvd))).toBe("CVD 合约 · USD · No Filter");
    expect(
      legendLabel(cvd, {}, { ...defaultSettings(cvd), symbolMode: "custom", symbol: "eth", market: "spot", unit: "coin", exchangeMode: "custom", exchanges: ["OKX", "Binance", "Bybit"] })
    ).toBe("CVD ETH · 现货 · 币 · OKX+2");
  });

  it("declare the full CoinGlass input set with sane defaults", () => {
    const oi = INDICATOR_BY_ID.get("cg_oi")!;
    const cvd = INDICATOR_BY_ID.get("cg_cvd")!;
    expect(oi.settings!.map((s) => s.key)).toEqual(["symbolMode", "symbol", "margin", "unit", "exchangeMode", "exchanges", "display", "lineSource"]);
    expect(cvd.settings!.map((s) => s.key)).toEqual(["symbolMode", "symbol", "market", "unit", "exchangeMode", "exchanges", "display", "lineSource"]);
    expect(defaultSettings(oi)).toEqual({
      symbolMode: "main", symbol: "", margin: "coin", unit: "usd", exchangeMode: "all", exchanges: [], display: "candles", lineSource: "open",
    });
    expect(defaultSettings(cvd).market).toBe("futures");
    // defaults are copied, never shared between instances
    const a = defaultSettings(cvd), b = defaultSettings(cvd);
    expect(a.exchanges).not.toBe(b.exchanges);
  });

  it("shows dependent settings only when their parents allow it, cascading", () => {
    const oi = INDICATOR_BY_ID.get("cg_oi")!;
    const defs = oi.settings!;
    const by = (k: string) => defs.find((d) => d.key === k)!;
    const base = defaultSettings(oi);
    expect(settingVisible(by("symbol"), base, defs)).toBe(false);
    expect(settingVisible(by("symbol"), { ...base, symbolMode: "custom" }, defs)).toBe(true);
    expect(settingVisible(by("lineSource"), base, defs)).toBe(false);
    expect(settingVisible(by("lineSource"), { ...base, display: "line" }, defs)).toBe(true);
    // exchanges needs exchangeMode=custom AND a margin type that supports filtering
    expect(settingVisible(by("exchanges"), { ...base, exchangeMode: "custom" }, defs)).toBe(true);
    expect(settingVisible(by("exchangeMode"), { ...base, margin: "all" }, defs)).toBe(false);
    expect(settingVisible(by("exchanges"), { ...base, exchangeMode: "custom", margin: "all" }, defs)).toBe(false);
  });

  it("swaps the CVD exchange list between spot and futures", () => {
    const cvd = INDICATOR_BY_ID.get("cg_cvd")!;
    const ex = cvd.settings!.find((d) => d.key === "exchanges")!;
    const spot = settingOptions(ex, { market: "spot" }).map((o) => o.value);
    const fut = settingOptions(ex, { market: "futures" }).map((o) => o.value);
    expect(spot).toContain("Coinbase");
    expect(fut).toContain("Hyperliquid");
    expect(spot).not.toContain("Hyperliquid");
  });
});

describe("resolveCandleStyle", () => {
  it("defaults to the chart theme with borders/wicks following the body colour", () => {
    const s = resolveCandleStyle(undefined, "oi");
    expect(s.upColor).toBe(CHART.up);
    expect(s.downColor).toBe(CHART.down);
    expect(s.borderUpColor).toBe(CHART.up);
    expect(s.wickDownColor).toBe(CHART.down);
    // 与主图蜡烛一致：右轴显示最新值标签，并画一条横向价格线
    expect(s.lastValueVisible).toBe(true);
    expect(s.priceLineVisible).toBe(true);
    expect(s.precision).toBe(2);
  });

  it("lets the body override cascade to border/wick unless those are set explicitly", () => {
    const s = resolveCandleStyle({ oi: { upColor: "#111111", wickUpColor: "#222222" } }, "oi");
    expect(s.upColor).toBe("#111111");
    expect(s.borderUpColor).toBe("#111111");
    expect(s.wickUpColor).toBe("#222222");
    expect(s.downColor).toBe(CHART.down);
  });

  it("reads flags and precision from the override", () => {
    const s = resolveCandleStyle({ oi: { lastValueVisible: false, priceLineVisible: false, precision: 0 } }, "oi");
    expect(s.lastValueVisible).toBe(false);
    expect(s.priceLineVisible).toBe(false);
    expect(s.precision).toBe(0);
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
