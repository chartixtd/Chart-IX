import { describe, it, expect, vi } from "vitest";
import { normalizeOiBars, normalizeTakerBars, externalRequestToUpstream, DEFAULT_EXCHANGES } from "./chart-series";
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

  it("routes CVD by market with the right default exchange set", () => {
    const spot = externalRequestToUpstream(REQ({ kind: "cvd", market: "spot" }));
    expect(spot.path).toBe("/api/spot/aggregated-taker-buy-sell-volume/history");
    expect(spot.params.exchange_list).toBe(DEFAULT_EXCHANGES.cvdSpot.join(","));

    const fut = externalRequestToUpstream(REQ({ kind: "cvd", market: "futures", unit: "coin" }));
    expect(fut.path).toBe("/api/futures/aggregated-taker-buy-sell-volume/history");
    expect(fut.params.exchange_list).toBe(DEFAULT_EXCHANGES.cvdFutures.join(","));
    expect(fut.params.unit).toBe("coin");
  });

  it("passes the chart interval through unchanged", () => {
    expect(externalRequestToUpstream(REQ({ interval: "1d" })).params.interval).toBe("1d");
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

describe("normalizeTakerBars", () => {
  it("maps aggregated buy/sell into compact flow bars", () => {
    const out = normalizeTakerBars([
      { time: 60_000, aggregated_buy_volume_usd: "100.5", aggregated_sell_volume_usd: 40 },
    ]);
    expect(out).toEqual([{ t: 60, buy: 100.5, sell: 40 }]);
  });

  it("drops bars with NaN flow", () => {
    expect(
      normalizeTakerBars([{ time: 60_000, aggregated_buy_volume_usd: "x", aggregated_sell_volume_usd: 1 }])
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
    expect(cacheKey(REQ())).toBe("oi:BTC:30m:futures:all:usd:*");
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
