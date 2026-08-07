import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SymbolSpec } from "@/types/trading";

const SPEC: SymbolSpec = {
  symbol: "BTC-USDT",
  market: "spot",
  pricePrecision: 1,
  quantityPrecision: 6,
  minQty: 0.0001,
  minNotional: 5,
  tradable: true,
};

const getSpotTicker = vi.fn();
const getFuturesTicker = vi.fn();
const getSymbolSpec = vi.fn();

vi.mock("@/lib/bingx/market", () => ({
  getSpotTicker: (...args: unknown[]) => getSpotTicker(...args),
  getFuturesTicker: (...args: unknown[]) => getFuturesTicker(...args),
}));

vi.mock("./spec", () => ({
  getSymbolSpec: (...args: unknown[]) => getSymbolSpec(...args),
}));

const { preflightOrder } = await import("./preflight");

/** 每次调用都取当前时间，避免测试执行耗时把 closeTime 拖出新鲜度窗口 */
function freshTicker(lastPrice: string | number = "60000") {
  return { lastPrice, closeTime: Date.now() };
}

beforeEach(() => {
  getSpotTicker.mockReset().mockImplementation(async () => freshTicker());
  getFuturesTicker.mockReset().mockImplementation(async () => freshTicker());
  getSymbolSpec.mockReset().mockResolvedValue(SPEC);
});

describe("preflightOrder — 估值必须用服务端市价，不能采信客户端报价", () => {
  it("an honest market order passes through", async () => {
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.riskNotionalUsdt).toBeCloseTo(100, 0);
      expect(result.marketPrice).toBe(60000);
    }
  });

  it("market orders size off the server price, not the client-supplied one", async () => {
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 1,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 100 / 60000, not 100 / 1
      expect(result.sizing.qty).toBeCloseTo(0.00166666, 5);
      expect(result.sizing.qty).not.toBeCloseTo(100, 0);
    }
  });

  // 这条是「谎报价格不能扭曲敞口估值」的核心证据：限价单的换算基准仍是用户填的
  // 限价（那是真实意图），但 riskNotionalUsdt 必须按服务端市价重算。原先还有一条
  // 配套测试断言谎报限价打不穿名义额上限，随管理员限额功能一并删除——被删的是
  // 上限本身，不是这条性质，它仍由下面的断言覆盖。
  it("limit orders size off the limit price but value risk off the market price", async () => {
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 30000,
      leverage: 1,
      isLimitOrder: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sizing.qty).toBeCloseTo(0.00333333, 5); // 100 / 30000
      expect(result.riskNotionalUsdt).toBeCloseTo(200, 0); // qty * 60000
    }
  });

  it("rejects when no market price is available", async () => {
    getSpotTicker.mockResolvedValue({ lastPrice: "", closeTime: Date.now() });
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result).toEqual({ ok: false, code: "NO_MARKET_PRICE" });
  });

  it("rejects when the ticker is null (e.g. an unwrapped empty array)", async () => {
    getSpotTicker.mockResolvedValue(null);
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result).toEqual({ ok: false, code: "NO_MARKET_PRICE" });
  });

  it("accepts a fresh quote", async () => {
    getSpotTicker.mockResolvedValue({ lastPrice: "60000", closeTime: Date.now() - 500 });
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a quote older than the freshness window", async () => {
    getSpotTicker.mockResolvedValue({ lastPrice: "60000", closeTime: Date.now() - 60_000 }); // 60s old
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result).toEqual({ ok: false, code: "NO_MARKET_PRICE" });
  });

  it("rejects a quote with a missing closeTime", async () => {
    getSpotTicker.mockResolvedValue({ lastPrice: "60000" });
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result).toEqual({ ok: false, code: "NO_MARKET_PRICE" });
  });

  it("rejects a quote with a closeTime far in the future beyond clock-skew allowance", async () => {
    getSpotTicker.mockResolvedValue({ lastPrice: "60000", closeTime: Date.now() + 60_000 }); // 60s ahead
    const result = await preflightOrder({
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 60000,
      leverage: 1,
      isLimitOrder: false,
    });
    expect(result).toEqual({ ok: false, code: "NO_MARKET_PRICE" });
  });

  it("propagates a ticker fetch failure instead of swallowing it", async () => {
    getSpotTicker.mockRejectedValueOnce(new Error("network down"));
    await expect(
      preflightOrder({
        market: "spot",
        symbol: "BTC-USDT",
        direction: "LONG",
        notionalUsdt: 100,
        referencePrice: 60000,
        leverage: 1,
        isLimitOrder: false,
      })
    ).rejects.toThrow("network down");
  });
});
