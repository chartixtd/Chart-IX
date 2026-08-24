import { describe, it, expect, vi } from "vitest";
import { normalizeOiBars, normalizeCvdBars, externalRequestToUpstream, DEFAULT_EXCHANGES } from "./chart-series";
import { createExternalSeriesCache, cacheKey, type ExternalSeriesCacheDeps } from "./chart-series-cache";
import type { ExternalOhlcBar, ExternalSeriesRequest } from "@/lib/chart/external-series";

const REQ = (over: Partial<ExternalSeriesRequest> = {}): ExternalSeriesRequest => ({
  kind: "oi", coin: "BTC", interval: "30m", market: "futures", margin: "all", unit: "usd", exchanges: null, ...over,
});

describe("externalRequestToUpstream", () => {
  it("routes OI by margin type and only sends exchange_list where the endpoint takes it", () => {
    const all = externalRequestToUpstream(REQ({ margin: "all", exchanges: ["Binance"] }));
    expect(all.path).toBe("/api/futures/open-interest/aggregated-history");
    expect(all.params).toEqual({ symbol: "BTC", interval: "30m", limit: 1000, unit: "usd" });

    const coin = externalRequestToUpstream(REQ({ margin: "coin" }));
    expect(coin.path).toBe("/api/futures/open-interest/aggregated-coin-margin-history");
    expect(coin.params.exchange_list).toBe(DEFAULT_EXCHANGES.oiCoin.join(","));

    const stable = externalRequestToUpstream(REQ({ margin: "stablecoin", exchanges: ["OKX", "Bybit"] }));
    expect(stable.path).toBe("/api/futures/open-interest/aggregated-stablecoin-margin-history");
    expect(stable.params.exchange_list).toBe("OKX,Bybit");
  });

  it("routes CVD to the dedicated aggregated-cvd endpoints (the ones that return cum_vol_delta)", () => {
    const spot = externalRequestToUpstream(REQ({ kind: "cvd", market: "spot" }));
    expect(spot.path).toBe("/api/spot/aggregated-cvd/history");
    expect(spot.params.exchange_list).toBe(DEFAULT_EXCHANGES.cvdSpot.join(","));

    const fut = externalRequestToUpstream(REQ({ kind: "cvd", market: "futures", unit: "coin" }));
    expect(fut.path).toBe("/api/futures/aggregated-cvd/history");
    expect(fut.params.exchange_list).toBe(DEFAULT_EXCHANGES.cvdFutures.join(","));
    expect(fut.params.unit).toBe("coin");
  });

  it("passes the chart interval through unchanged", () => {
    expect(externalRequestToUpstream(REQ({ interval: "1d" })).params.interval).toBe("1d");
  });

  // 两族端点的 limit 上限不同：OI ≤1000、CVD ≤4500。写死同一个数就是用户截图里
  // 「OI 铺满、CVD 只有一小段」的成因。
  it("asks each endpoint for as much history as it allows", () => {
    expect(externalRequestToUpstream(REQ({ kind: "oi", margin: "all" })).params.limit).toBe(1000);
    expect(externalRequestToUpstream(REQ({ kind: "oi", margin: "coin" })).params.limit).toBe(1000);
    expect(externalRequestToUpstream(REQ({ kind: "cvd", market: "futures" })).params.limit).toBe(4500);
    expect(externalRequestToUpstream(REQ({ kind: "cvd", market: "spot" })).params.limit).toBe(4500);
  });
});

describe("normalizeOiBars", () => {
  it("converts ms → s and parses mixed string/number fields", () => {
    const out = normalizeOiBars([
      { time: 1_700_000_000_000, open: "1", high: 2, low: "0.5", close: "1.5" },
    ]);
    expect(out).toEqual([{ t: 1_700_000_000, o: 1, h: 2, l: 0.5, c: 1.5 }]);
  });

  it("drops bars with any non-finite field and sorts ascending", () => {
    const out = normalizeOiBars([
      { time: 2_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_000, open: "abc", high: 1, low: 1, close: 1 },
      { time: 1_000, open: 1, high: 1, low: 1, close: 1 },
    ]);
    expect(out.map((b) => b.t)).toEqual([1, 2]);
  });

  it("keeps the last bar when the same timestamp repeats", () => {
    const out = normalizeOiBars([
      { time: 1_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_000, open: 9, high: 9, low: 9, close: 9 },
    ]);
    expect(out).toEqual([{ t: 1, o: 9, h: 9, l: 9, c: 9 }]);
  });
});

describe("normalizeCvdBars", () => {
  // 用 CoinGlass 自己的累计值当收盘价，开盘价由 cum − (buy − sell) 反推。
  it("uses cum_vol_delta as close and derives open from the bar's own net flow", () => {
    const out = normalizeCvdBars([
      { time: 60_000, agg_taker_buy_vol: "100", agg_taker_sell_vol: 40, cum_vol_delta: "10060" },
      { time: 120_000, agg_taker_buy_vol: 10, agg_taker_sell_vol: 50, cum_vol_delta: 10020 },
    ]);
    expect(out).toEqual([
      { t: 60, o: 10000, h: 10060, l: 10000, c: 10060 },
      { t: 120, o: 10060, h: 10060, l: 10020, c: 10020 },
    ]);
  });

  it("keeps the absolute level upstream gave it — never re-accumulates from zero", () => {
    // 这正是换端点要修的病：从 0 累加会把 10060 变成 60。
    const out = normalizeCvdBars([
      { time: 60_000, agg_taker_buy_vol: 100, agg_taker_sell_vol: 40, cum_vol_delta: 10060 },
    ]);
    expect(out[0].c).toBe(10060);
  });

  it("produces wickless candles (H = max(o,c), L = min(o,c))", () => {
    const out = normalizeCvdBars([
      { time: 60_000, agg_taker_buy_vol: 100, agg_taker_sell_vol: 40, cum_vol_delta: 10060 },
      { time: 120_000, agg_taker_buy_vol: 10, agg_taker_sell_vol: 50, cum_vol_delta: 10020 },
    ]);
    for (const b of out) {
      expect(b.h).toBe(Math.max(b.o, b.c));
      expect(b.l).toBe(Math.min(b.o, b.c));
    }
  });

  it("drops bars with any non-finite field", () => {
    expect(
      normalizeCvdBars([{ time: 60_000, agg_taker_buy_vol: "x", agg_taker_sell_vol: 1, cum_vol_delta: 5 }])
    ).toEqual([]);
    expect(
      normalizeCvdBars([{ time: 60_000, agg_taker_buy_vol: 1, agg_taker_sell_vol: 1, cum_vol_delta: "bad" }])
    ).toEqual([]);
  });
});

// ---- cache ----

const BAR: ExternalOhlcBar = { t: 1, o: 1, h: 1, l: 1, c: 1 };
const MIN = 60_000;

function makeDeps(overrides: Partial<ExternalSeriesCacheDeps> = {}) {
  let now = 0;
  const db = new Map<string, { bars: ExternalOhlcBar[]; fetchedAt: number }>();
  const fetchUpstream = vi.fn(async (_r: ExternalSeriesRequest) => [{ ...BAR, c: now }]);
  const deps: ExternalSeriesCacheDeps = {
    now: () => now,
    fetchUpstream,
    readDb: vi.fn(async (key) => db.get(key) ?? null),
    writeDb: vi.fn(async (key, entry) => {
      db.set(key, entry as { bars: ExternalOhlcBar[]; fetchedAt: number });
    }),
    ...overrides,
  };
  return {
    deps,
    db,
    fetchUpstream,
    advance: (ms: number) => { now += ms; },
  };
}

describe("createExternalSeriesCache", () => {
  it("hits upstream once within the TTL, then again after it expires (30m → 5 min)", async () => {
    const { deps, fetchUpstream, advance } = makeDeps();
    const cache = createExternalSeriesCache(deps);

    await cache.get(REQ());
    await cache.get(REQ());
    advance(4 * MIN);
    await cache.get(REQ());
    expect(fetchUpstream).toHaveBeenCalledTimes(1);

    advance(2 * MIN);
    await cache.get(REQ());
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it("keys on kind + coin + interval independently", async () => {
    const { deps, fetchUpstream } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    await cache.get(REQ());
    await cache.get(REQ({ kind: "cvd" }));
    await cache.get(REQ({ coin: "ETH" }));
    await cache.get(REQ({ interval: "1h" }));
    expect(fetchUpstream).toHaveBeenCalledTimes(4);
    expect(cacheKey(REQ())).toBe("v3:oi:BTC:30m:futures:all:usd:*");
  });

  it("serves a fresh DB row without touching upstream (cross-instance share)", async () => {
    const { deps, db, fetchUpstream } = makeDeps();
    db.set(cacheKey(REQ()), { bars: [BAR], fetchedAt: 0 });
    const cache = createExternalSeriesCache(deps);
    const r = await cache.get(REQ());
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(r.bars).toEqual([BAR]);
    expect(r.stale).toBe(false);
  });

  it("writes through to the DB after an upstream fetch", async () => {
    const { deps, db } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    await cache.get(REQ({ kind: "cvd", coin: "SOL", interval: "1h" }));
    // writeDb is fire-and-forget; let the microtask settle
    await Promise.resolve();
    expect(db.has(cacheKey(REQ({ kind: "cvd", coin: "SOL", interval: "1h" })))).toBe(true);
  });

  it("dedupes concurrent requests for the same key into one upstream call", async () => {
    const { deps, fetchUpstream } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    await Promise.all([
      cache.get(REQ()),
      cache.get(REQ()),
      cache.get(REQ()),
    ]);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale data (flagged) when upstream fails, and throws only with nothing cached", async () => {
    const { deps, fetchUpstream, advance } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    const first = await cache.get(REQ());
    expect(first.stale).toBe(false);

    advance(10 * MIN);
    fetchUpstream.mockRejectedValueOnce(new Error("429"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = await cache.get(REQ());
    warn.mockRestore();
    expect(stale.stale).toBe(true);
    expect(stale.bars).toEqual(first.bars);

    fetchUpstream.mockRejectedValueOnce(new Error("429"));
    await expect(cache.get(REQ({ coin: "NEW" }))).rejects.toThrow("429");
  });

  it("ignores DB read failures and still works as a memory cache", async () => {
    const { deps, fetchUpstream } = makeDeps({
      readDb: async () => { throw new Error("relation does not exist"); },
    });
    const cache = createExternalSeriesCache({
      ...deps,
      // the real readDb swallows; emulate that contract here
      readDb: async () => null,
    });
    await cache.get(REQ());
    await cache.get(REQ());
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });
});
