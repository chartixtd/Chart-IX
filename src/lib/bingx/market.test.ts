import { describe, it, expect, vi, beforeEach } from "vitest";

const publicRequest = vi.fn();

vi.mock("./client", () => ({
  bingxClient: { publicRequest: (...args: unknown[]) => publicRequest(...args) },
}));

const { getSpotTicker } = await import("./market");

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
