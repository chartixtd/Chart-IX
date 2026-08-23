import { describe, it, expect, vi } from "vitest";
import { normalizeOiBars, normalizeTakerBars } from "./chart-series";
import { createExternalSeriesCache, cacheKey, type ExternalSeriesCacheDeps } from "./chart-series-cache";
import type { ExternalOhlcBar } from "@/lib/chart/external-series";

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
  const fetchUpstream = vi.fn(async () => [{ ...BAR, c: now }]);
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

    await cache.get("oi", "BTC", "30m");
    await cache.get("oi", "BTC", "30m");
    advance(4 * MIN);
    await cache.get("oi", "BTC", "30m");
    expect(fetchUpstream).toHaveBeenCalledTimes(1);

    advance(2 * MIN);
    await cache.get("oi", "BTC", "30m");
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it("keys on kind + coin + interval independently", async () => {
    const { deps, fetchUpstream } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    await cache.get("oi", "BTC", "30m");
    await cache.get("cvd", "BTC", "30m");
    await cache.get("oi", "ETH", "30m");
    await cache.get("oi", "BTC", "1h");
    expect(fetchUpstream).toHaveBeenCalledTimes(4);
    expect(cacheKey("oi", "BTC", "30m")).toBe("oi:BTC:30m");
  });

  it("serves a fresh DB row without touching upstream (cross-instance share)", async () => {
    const { deps, db, fetchUpstream } = makeDeps();
    db.set(cacheKey("oi", "BTC", "30m"), { bars: [BAR], fetchedAt: 0 });
    const cache = createExternalSeriesCache(deps);
    const r = await cache.get("oi", "BTC", "30m");
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(r.bars).toEqual([BAR]);
    expect(r.stale).toBe(false);
  });

  it("writes through to the DB after an upstream fetch", async () => {
    const { deps, db } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    await cache.get("cvd", "SOL", "1h");
    // writeDb is fire-and-forget; let the microtask settle
    await Promise.resolve();
    expect(db.has(cacheKey("cvd", "SOL", "1h"))).toBe(true);
  });

  it("dedupes concurrent requests for the same key into one upstream call", async () => {
    const { deps, fetchUpstream } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    await Promise.all([
      cache.get("oi", "BTC", "30m"),
      cache.get("oi", "BTC", "30m"),
      cache.get("oi", "BTC", "30m"),
    ]);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale data (flagged) when upstream fails, and throws only with nothing cached", async () => {
    const { deps, fetchUpstream, advance } = makeDeps();
    const cache = createExternalSeriesCache(deps);
    const first = await cache.get("oi", "BTC", "30m");
    expect(first.stale).toBe(false);

    advance(10 * MIN);
    fetchUpstream.mockRejectedValueOnce(new Error("429"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = await cache.get("oi", "BTC", "30m");
    warn.mockRestore();
    expect(stale.stale).toBe(true);
    expect(stale.bars).toEqual(first.bars);

    fetchUpstream.mockRejectedValueOnce(new Error("429"));
    await expect(cache.get("oi", "NEW", "30m")).rejects.toThrow("429");
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
    await cache.get("oi", "BTC", "30m");
    await cache.get("oi", "BTC", "30m");
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });
});
