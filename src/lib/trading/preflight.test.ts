import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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

const USER_ID = "11111111-1111-1111-1111-111111111111";

const getSpotTicker = vi.fn();
const getFuturesTicker = vi.fn();
const getSymbolSpec = vi.fn();
const countOrdersToday = vi.fn();

vi.mock("@/lib/bingx/market", () => ({
  getSpotTicker: (...args: unknown[]) => getSpotTicker(...args),
  getFuturesTicker: (...args: unknown[]) => getFuturesTicker(...args),
}));

vi.mock("./spec", () => ({
  getSymbolSpec: (...args: unknown[]) => getSymbolSpec(...args),
}));

vi.mock("./persist", () => ({
  countOrdersToday: (...args: unknown[]) => countOrdersToday(...args),
}));

const { preflightOrder } = await import("./preflight");

/** 最小手写 Supabase 替身：只实现 loadLimitsFor 用到的 from().select().or() 链 */
function makeSupabase(limitsRows: Record<string, unknown>[] = []): SupabaseClient {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            or(_filter: string) {
              return Promise.resolve({ data: limitsRows, error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const CAPPED_500 = [
  {
    user_id: null,
    max_notional_per_order: 500,
    max_orders_per_day: null,
    max_leverage: null,
    allowed_symbols: null,
  },
];

/** 每次调用都取当前时间，避免测试执行耗时把 closeTime 拖出新鲜度窗口 */
function freshTicker(lastPrice: string | number = "60000") {
  return { lastPrice, closeTime: Date.now() };
}

beforeEach(() => {
  getSpotTicker.mockReset().mockImplementation(async () => freshTicker());
  getFuturesTicker.mockReset().mockImplementation(async () => freshTicker());
  getSymbolSpec.mockReset().mockResolvedValue(SPEC);
  countOrdersToday.mockReset().mockResolvedValue(0);
});

describe("preflightOrder — risk valuation must use the server-fetched market price", () => {
  // Brief 里把这条标成"市价单"，但市价单的换算基准已经完全不看客户端价格
  // （见下面第 3 条测试），notionalUsdt=100 的市价单无论 referencePrice 填什么，
  // 换算出的敞口都 ≈100，永远打不到 500 的上限——那条断言在市价单语境下不成立。
  // 真正能验证"谎报价格击穿名义额上限"这条安全性质的，是限价单：限价单的换算
  // 基准仍然是用户填的（真实意图），如果风控估值也用同一个价格算，就还是原来的洞。
  // 这里改成限价单以外的语义不变——限额、市价、名义额都和 brief 一致。
  it("a lying low limit price cannot defeat the notional cap", async () => {
    const supabase = makeSupabase(CAPPED_500);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
      market: "spot",
      symbol: "BTC-USDT",
      direction: "LONG",
      notionalUsdt: 100,
      referencePrice: 1,
      leverage: 1,
      isLimitOrder: true,
    });
    expect(result).toEqual({ ok: false, code: "NOTIONAL_TOO_LARGE", limit: 500 });
  });

  it("an honest market order passes through", async () => {
    const supabase = makeSupabase(CAPPED_500);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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

  it("limit orders size off the limit price but value risk off the market price", async () => {
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    const result = await preflightOrder(supabase, {
      userId: USER_ID,
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
    const supabase = makeSupabase([]);
    await expect(
      preflightOrder(supabase, {
        userId: USER_ID,
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
