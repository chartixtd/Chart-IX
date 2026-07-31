import { describe, it, expect, vi, beforeEach } from "vitest";

const publicRequest = vi.fn();

vi.mock("./client", () => ({
  bingxClient: { publicRequest: (...args: unknown[]) => publicRequest(...args) },
}));

const { getSpotTicker, getSpotKlines, getFuturesKlines } = await import("./market");

beforeEach(() => {
  publicRequest.mockReset();
});

// Guards Finding 3: BingX wraps a single-symbol spot ticker query in a
// length-1 array (`data: [ {...} ]`) instead of returning the object
// directly. The old implementation asserted the raw response as BingXTicker
// and handed the caller an array, so `.lastPrice` was always undefined and
// every spot order was rejected with NO_MARKET_PRICE.
describe("getSpotTicker", () => {
  it("unwraps a single-element array response into the ticker object", async () => {
    publicRequest.mockResolvedValue([
      { symbol: "BTC-USDT", lastPrice: 63923.02, closeTime: Date.now() },
    ]);
    const ticker = await getSpotTicker("BTC-USDT");
    expect(ticker).not.toBeNull();
    expect(ticker?.symbol).toBe("BTC-USDT");
    expect(ticker?.lastPrice).toBe(63923.02);
  });

  it("uses an object response directly if BingX ever returns one unwrapped", async () => {
    publicRequest.mockResolvedValue({ symbol: "BTC-USDT", lastPrice: "63899.4", closeTime: Date.now() });
    const ticker = await getSpotTicker("BTC-USDT");
    expect(ticker?.lastPrice).toBe("63899.4");
  });

  it("returns null for an empty array instead of throwing", async () => {
    publicRequest.mockResolvedValue([]);
    expect(await getSpotTicker("NOPE-USDT")).toBeNull();
  });

  it("returns null for a null/undefined response instead of throwing", async () => {
    publicRequest.mockResolvedValue(null);
    expect(await getSpotTicker("NOPE-USDT")).toBeNull();
  });
});

describe("getSpotKlines", () => {
  it("passes startTime/endTime through to the public request when provided", async () => {
    publicRequest.mockResolvedValue([]);
    await getSpotKlines("BTC-USDT", "1h", 300, 1000, 2000);
    expect(publicRequest).toHaveBeenCalledWith(
      "/openApi/spot/v1/market/kline",
      { symbol: "BTC-USDT", interval: "1h", limit: 300, startTime: 1000, endTime: 2000 }
    );
  });

  it("maps raw kline rows into BingXKline objects", async () => {
    publicRequest.mockResolvedValue([
      [1700000000000, "63000", "63500", "62800", "63200", "12.5", 1700003599999, "789000", 42],
    ]);
    const klines = await getSpotKlines("BTC-USDT");
    expect(klines).toEqual([{
      openTime: 1700000000000,
      open: 63000,
      high: 63500,
      low: 62800,
      close: 63200,
      volume: 12.5,
      closeTime: 1700003599999,
      quoteVolume: 789000,
      trades: 42,
    }]);
  });
});

describe("getFuturesKlines", () => {
  it("passes startTime/endTime through to the public request when provided", async () => {
    publicRequest.mockResolvedValue([]);
    await getFuturesKlines("BTC-USDT", "1h", 300, 1000, 2000);
    expect(publicRequest).toHaveBeenCalledWith(
      "/openApi/swap/v3/quote/klines",
      { symbol: "BTC-USDT", interval: "1h", limit: 300, startTime: 1000, endTime: 2000 }
    );
  });

  it("omits startTime/endTime from the params object when not provided", async () => {
    publicRequest.mockResolvedValue([]);
    await getFuturesKlines("BTC-USDT", "1h", 100);
    expect(publicRequest).toHaveBeenCalledWith(
      "/openApi/swap/v3/quote/klines",
      { symbol: "BTC-USDT", interval: "1h", limit: 100, startTime: undefined, endTime: undefined }
    );
  });
});
