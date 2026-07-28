import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BingXSymbol, BingXContract } from "@/types/bingx";

const spotRows: BingXSymbol[] = [
  { symbol: "BTC-USDT", minQty: 0.0001, maxQty: 100, minNotional: 5, maxNotional: 1e6, tickSize: 0.1, stepSize: 0.000001, status: 1 },
];

const futuresRows: BingXContract[] = [
  {
    symbol: "BTC-USDT", asset: "BTC", currency: "USDT", size: "1",
    pricePrecision: 1, quantityPrecision: 4, tradeMinQuantity: 0.0001, tradeMinUSDT: 2,
    maxLongLeverage: 125, maxShortLeverage: 100, makerFeeRate: 0.0002, takerFeeRate: 0.0005,
    status: 1, apiStateOpen: "true", apiStateClose: "true",
  },
];

const getSpotSymbols = vi.fn();
const getFuturesContracts = vi.fn();

vi.mock("@/lib/bingx/market", () => ({
  getSpotSymbols: (...args: unknown[]) => getSpotSymbols(...args),
  getFuturesContracts: (...args: unknown[]) => getFuturesContracts(...args),
}));

const { getSymbolSpec, clearSpecCache } = await import("./spec");

beforeEach(() => {
  clearSpecCache();
  getSpotSymbols.mockReset().mockResolvedValue(spotRows);
  getFuturesContracts.mockReset().mockResolvedValue(futuresRows);
});

describe("getSymbolSpec", () => {
  it("returns a normalized spot spec", async () => {
    const spec = await getSymbolSpec("BTC-USDT", "spot");
    expect(spec).toMatchObject({ symbol: "BTC-USDT", market: "spot", minNotional: 5, quantityPrecision: 6 });
  });

  it("returns a normalized futures spec with the side-specific leverage cap", async () => {
    expect((await getSymbolSpec("BTC-USDT", "futures", "LONG"))?.maxLeverage).toBe(125);
    expect((await getSymbolSpec("BTC-USDT", "futures", "SHORT"))?.maxLeverage).toBe(100);
  });

  it("defaults to the LONG leverage cap when no side is given", async () => {
    expect((await getSymbolSpec("BTC-USDT", "futures"))?.maxLeverage).toBe(125);
  });

  it("returns null for an unknown symbol", async () => {
    expect(await getSymbolSpec("NOPE-USDT", "spot")).toBeNull();
  });

  it("fetches the list only once across repeated lookups", async () => {
    await getSymbolSpec("BTC-USDT", "spot");
    await getSymbolSpec("BTC-USDT", "spot");
    await getSymbolSpec("BTC-USDT", "spot");
    expect(getSpotSymbols).toHaveBeenCalledTimes(1);
  });

  it("does not share cache between spot and futures", async () => {
    await getSymbolSpec("BTC-USDT", "spot");
    await getSymbolSpec("BTC-USDT", "futures");
    expect(getSpotSymbols).toHaveBeenCalledTimes(1);
    expect(getFuturesContracts).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch", async () => {
    getSpotSymbols.mockRejectedValueOnce(new Error("network down"));
    await expect(getSymbolSpec("BTC-USDT", "spot")).rejects.toThrow("network down");
    getSpotSymbols.mockResolvedValue(spotRows);
    expect(await getSymbolSpec("BTC-USDT", "spot")).not.toBeNull();
  });

  it("coalesces concurrent lookups into a single fetch", async () => {
    const [a, b] = await Promise.all([
      getSymbolSpec("BTC-USDT", "spot"),
      getSymbolSpec("BTC-USDT", "spot"),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(getSpotSymbols).toHaveBeenCalledTimes(1);
  });

  // Extra test (not in the brief): the 8 specified tests never let time pass,
  // so the TTL comparison (`expiresAt > Date.now()`) is never actually exercised
  // one way or the other. This pins the boundary: still cached 1ms before the
  // 1-hour mark, refetched exactly at and after it.
  it("re-fetches once the cached list is older than the 1-hour TTL", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      await getSymbolSpec("BTC-USDT", "spot");
      expect(getSpotSymbols).toHaveBeenCalledTimes(1);

      vi.setSystemTime(60 * 60 * 1000 - 1); // 1ms before TTL expiry: still cached
      await getSymbolSpec("BTC-USDT", "spot");
      expect(getSpotSymbols).toHaveBeenCalledTimes(1);

      vi.setSystemTime(60 * 60 * 1000); // exactly at expiry: must be treated as stale
      await getSymbolSpec("BTC-USDT", "spot");
      expect(getSpotSymbols).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
