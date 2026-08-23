import { describe, it, expect } from "vitest";
import {
  alignOhlcToTimes,
  buildExternalRequest,
  coinFromChartSymbol,
  emptyCandles,
  exchangeChoicesFor,
  externalRequestKey,
  externalRequestToQuery,
  externalSeriesTtlMs,
  isCandlePoint,
  isExternalIntervalSupported,
  isExternalKind,
  isValidExchangeName,
  isValidExternalCoin,
  lastNBarsFromSettings,
  parseExchangeList,
  rebaseLastN,
  parseExternalSeriesQuery,
  EXTERNAL_SERIES_INTERVALS,
  FUTURES_EXCHANGE_CHOICES,
  SPOT_EXCHANGE_CHOICES,
  type ExternalSeriesRequest,
} from "./external-series";

const H = 3600;

describe("interval / kind / coin / exchange validation", () => {
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

  it("exchange names: letters, digits, . _ - only — nothing that could smuggle a query param", () => {
    expect(isValidExchangeName("Binance")).toBe(true);
    expect(isValidExchangeName("Crypto.com")).toBe(true);
    expect(isValidExchangeName("dYdX_v4")).toBe(true);
    expect(isValidExchangeName("Binance,OKX")).toBe(false);
    expect(isValidExchangeName("a&b")).toBe(false);
    expect(isValidExchangeName("")).toBe(false);
  });
});

describe("coinFromChartSymbol", () => {
  it("strips quote suffixes and contract multipliers, uppercases, trims", () => {
    expect(coinFromChartSymbol("BTC-USDT")).toBe("BTC");
    expect(coinFromChartSymbol("eth-usdc")).toBe("ETH");
    expect(coinFromChartSymbol("1000PEPE-USDT")).toBe("PEPE");
    expect(coinFromChartSymbol("  sol ")).toBe("SOL");
    expect(coinFromChartSymbol("ETH")).toBe("ETH");
  });
});

describe("parseExchangeList", () => {
  it("splits on commas/whitespace, trims, dedupes case-insensitively, drops invalid", () => {
    expect(parseExchangeList("Binance, OKX ,okx\nBybit bad&name")).toEqual(["Binance", "OKX", "Bybit"]);
    expect(parseExchangeList("")).toEqual([]);
    expect(parseExchangeList(null)).toEqual([]);
  });

  it("caps at MAX_EXCHANGES entries", () => {
    const many = Array.from({ length: 60 }, (_, i) => `Ex${i}`).join(",");
    expect(parseExchangeList(many)).toHaveLength(40);
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

describe("buildExternalRequest", () => {
  it("follows the chart symbol by default with CoinGlass-matching defaults (futures CVD, coin-margined OI, USD, No Filter)", () => {
    expect(buildExternalRequest("cvd", undefined, "BTC-USDT", "30m")).toEqual({
      kind: "cvd", coin: "BTC", interval: "30m", market: "futures", margin: "all", unit: "usd", exchanges: null,
    });
    expect(buildExternalRequest("oi", {}, "1000PEPE-USDT", "1h")).toEqual({
      kind: "oi", coin: "PEPE", interval: "1h", market: "futures", margin: "coin", unit: "usd", exchanges: null,
    });
  });

  it("uses the custom symbol when symbolMode=custom, normalising any spelling", () => {
    const r = buildExternalRequest("cvd", { symbolMode: "custom", symbol: "eth-usdt" }, "BTC-USDT", "30m");
    expect(r?.coin).toBe("ETH");
  });

  it("returns null for an empty or invalid custom symbol (instance shows 'invalid' instead of fetching)", () => {
    expect(buildExternalRequest("cvd", { symbolMode: "custom", symbol: "" }, "BTC-USDT", "30m")).toBeNull();
    expect(buildExternalRequest("cvd", { symbolMode: "custom", symbol: "??" }, "BTC-USDT", "30m")).toBeNull();
  });

  it("applies market/margin/unit and ignores keys that don't belong to the kind", () => {
    const cvd = buildExternalRequest("cvd", { market: "spot", margin: "coin", unit: "coin" }, "BTC-USDT", "30m")!;
    expect(cvd.market).toBe("spot");
    expect(cvd.margin).toBe("all"); // margin is an OI concept
    expect(cvd.unit).toBe("coin");
    const oi = buildExternalRequest("oi", { market: "spot", margin: "stablecoin" }, "BTC-USDT", "30m")!;
    expect(oi.market).toBe("futures"); // market is a CVD concept
    expect(oi.margin).toBe("stablecoin");
  });

  it("falls back to defaults for unknown option values", () => {
    const r = buildExternalRequest("oi", { margin: "weird", unit: "eur", display: "x" }, "BTC-USDT", "30m")!;
    expect(r.margin).toBe("coin");
    expect(r.unit).toBe("usd");
  });

  it("custom exchanges are passed through only when selected and non-empty", () => {
    const custom = buildExternalRequest("cvd", { exchangeMode: "custom", exchanges: ["OKX", "Binance"] }, "BTC-USDT", "30m")!;
    expect(custom.exchanges).toEqual(["OKX", "Binance"]);
    const empty = buildExternalRequest("cvd", { exchangeMode: "custom", exchanges: [] }, "BTC-USDT", "30m")!;
    expect(empty.exchanges).toBeNull();
    const ignored = buildExternalRequest("cvd", { exchangeMode: "all", exchanges: ["OKX"] }, "BTC-USDT", "30m")!;
    expect(ignored.exchanges).toBeNull();
  });

  it("drops the exchange filter for all-margin OI (that endpoint has no exchange_list)", () => {
    const r = buildExternalRequest("oi", { margin: "all", exchangeMode: "custom", exchanges: ["OKX"] }, "BTC-USDT", "30m")!;
    expect(r.exchanges).toBeNull();
  });
});

describe("externalRequestKey / externalRequestToQuery", () => {
  const base: ExternalSeriesRequest = {
    kind: "cvd", coin: "BTC", interval: "30m", market: "futures", margin: "all", unit: "usd", exchanges: null,
  };

  it("is stable and encodes every dimension", () => {
    expect(externalRequestKey(base)).toBe("v2:cvd:BTC:30m:futures:all:usd:*");
    expect(externalRequestKey({ ...base, unit: "coin" })).not.toBe(externalRequestKey(base));
    expect(externalRequestKey({ ...base, market: "spot" })).not.toBe(externalRequestKey(base));
  });

  it("treats exchange selection as a set (order-insensitive)", () => {
    const a = externalRequestKey({ ...base, exchanges: ["OKX", "Binance"] });
    const b = externalRequestKey({ ...base, exchanges: ["Binance", "OKX"] });
    expect(a).toBe(b);
    expect(a).toBe("v2:cvd:BTC:30m:futures:all:usd:Binance+OKX");
  });

  it("round-trips through the query string parser", () => {
    const r: ExternalSeriesRequest = { ...base, kind: "oi", margin: "stablecoin", exchanges: ["Binance", "OKX"] };
    const q = externalRequestToQuery(r);
    const parsed = parseExternalSeriesQuery((k) => q[k] ?? null);
    expect(parsed.ok && parsed.request).toEqual(r);
    const q2 = externalRequestToQuery(base);
    expect(q2.exchanges).toBeUndefined();
    const parsed2 = parseExternalSeriesQuery((k) => q2[k] ?? null);
    expect(parsed2.ok && parsed2.request).toEqual(base);
  });
});

describe("parseExternalSeriesQuery", () => {
  const q = (obj: Record<string, string>) => parseExternalSeriesQuery((k) => obj[k] ?? null);

  it("applies kind-specific defaults when optional params are absent", () => {
    const cvd = q({ kind: "cvd", coin: "BTC", interval: "30m" });
    expect(cvd.ok && cvd.request).toMatchObject({ market: "futures", margin: "all", unit: "usd", exchanges: null });
    const oi = q({ kind: "oi", coin: "BTC", interval: "1d" });
    expect(oi.ok && oi.request).toMatchObject({ market: "futures", margin: "coin", unit: "usd", exchanges: null });
  });

  it("rejects every bad field with a specific code", () => {
    expect(q({ kind: "x", coin: "BTC", interval: "30m" })).toMatchObject({ ok: false, code: "BAD_KIND" });
    expect(q({ kind: "oi", coin: "btc", interval: "30m" })).toMatchObject({ ok: false, code: "BAD_COIN" });
    expect(q({ kind: "oi", coin: "BTC", interval: "15m" })).toMatchObject({ ok: false, code: "UNSUPPORTED_INTERVAL" });
    expect(q({ kind: "cvd", coin: "BTC", interval: "30m", market: "otc" })).toMatchObject({ ok: false, code: "BAD_MARKET" });
    expect(q({ kind: "oi", coin: "BTC", interval: "30m", margin: "x" })).toMatchObject({ ok: false, code: "BAD_MARGIN" });
    expect(q({ kind: "oi", coin: "BTC", interval: "30m", unit: "eur" })).toMatchObject({ ok: false, code: "BAD_UNIT" });
    expect(q({ kind: "oi", coin: "BTC", interval: "30m", exchanges: "Binance,a&b" })).toMatchObject({ ok: false, code: "BAD_EXCHANGE" });
  });

  it("ignores exchanges for all-margin OI and normalises the list otherwise", () => {
    const all = q({ kind: "oi", coin: "BTC", interval: "30m", margin: "all", exchanges: "Binance" });
    expect(all.ok && all.request.exchanges).toBeNull();
    const coin = q({ kind: "oi", coin: "BTC", interval: "30m", margin: "coin", exchanges: "Binance, okx,OKX" });
    expect(coin.ok && coin.request.exchanges).toEqual(["Binance", "okx"]);
    const empty = q({ kind: "cvd", coin: "BTC", interval: "30m", exchanges: "" });
    expect(empty.ok && empty.request.exchanges).toBeNull();
  });
});

describe("exchange choices", () => {
  it("offers the spot list only for spot CVD", () => {
    expect(exchangeChoicesFor("cvd", "spot")).toBe(SPOT_EXCHANGE_CHOICES);
    expect(exchangeChoicesFor("cvd", "futures")).toBe(FUTURES_EXCHANGE_CHOICES);
    expect(exchangeChoicesFor("oi", "futures")).toBe(FUTURES_EXCHANGE_CHOICES);
  });

  it("every listed name passes the exchange-name validator", () => {
    for (const n of [...FUTURES_EXCHANGE_CHOICES, ...SPOT_EXCHANGE_CHOICES]) {
      expect(isValidExchangeName(n), n).toBe(true);
    }
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

describe("rebaseLastN — CoinGlass 的 Only last N bars", () => {
  const c = (v: number) => ({ open: v, high: v + 1, low: v - 1, close: v + 0.5 });
  const series = [c(100), c(110), c(120), c(130)];

  it("从倒数第 N 根的 open 归零，之前的根置空", () => {
    expect(rebaseLastN(series, 2)).toEqual([
      null, null,
      { open: 0, high: 1, low: -1, close: 0.5 },
      { open: 10, high: 11, low: 9, close: 10.5 },
    ]);
  });

  it("这正是让两边读数相等的机制：同一 N 下，相差常数的两条序列归零后完全一致", () => {
    const offset = series.map((b) => ({ open: b.open + 3200, high: b.high + 3200, low: b.low + 3200, close: b.close + 3200 }));
    expect(rebaseLastN(offset, 3)).toEqual(rebaseLastN(series, 3));
  });

  it("N<=0 / N>=长度 一律原样返回（= 全部）", () => {
    expect(rebaseLastN(series, 0)).toBe(series);
    expect(rebaseLastN(series, -5)).toBe(series);
    expect(rebaseLastN(series, 4)).toBe(series);
    expect(rebaseLastN(series, NaN)).toBe(series);
  });

  it("窗口里第一根是空时，锚点顺延到第一根有值的", () => {
    const out = rebaseLastN([c(100), null, c(120), c(130)], 3);
    expect(out[1]).toBeNull();
    expect(out[2]).toEqual({ open: 0, high: 1, low: -1, close: 0.5 });
    expect(out[3]).toEqual({ open: 10, high: 11, low: 9, close: 10.5 });
  });

  it("整段都是空时原样返回，不会把序列擦掉", () => {
    const empty = [c(100), null, null];
    expect(rebaseLastN(empty, 2)).toBe(empty);
  });
});

describe("lastNBarsFromSettings", () => {
  it("只接受正整数，其余一律当 0（全部）", () => {
    expect(lastNBarsFromSettings({ lastNBars: "300" })).toBe(300);
    expect(lastNBarsFromSettings({ lastNBars: "300.7" })).toBe(300);
    expect(lastNBarsFromSettings({ lastNBars: "0" })).toBe(0);
    expect(lastNBarsFromSettings({ lastNBars: "-5" })).toBe(0);
    expect(lastNBarsFromSettings({ lastNBars: "abc" })).toBe(0);
    expect(lastNBarsFromSettings({})).toBe(0);
    expect(lastNBarsFromSettings(undefined)).toBe(0);
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
