import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 对账的三个真实坑，每一个都出现过或差点出现：
 *  1. 合约的单笔订单查询把订单裹在 data.order 里，现货是平铺的；
 *  2. 合约手续费不在订单对象里，要另查 allFillOrders，而那个接口
 *     把数组裹在 data.fill_orders 里、手续费币种字段叫 currency；
 *  3. 交易所在中间态会回空的成交字段，整体覆盖会把已经对出来的成交价抹掉。
 */

const queryFuturesOrder = vi.fn();
const queryFuturesFullOrder = vi.fn();
const getFuturesAllFillOrders = vi.fn();
const queryOrder = vi.fn();
const getDecryptedApiKeys = vi.fn();

/** 记录每一次 update 的 patch，断言用 */
const updates: { id: string; patch: Record<string, unknown> }[] = [];
let selectRows: unknown[] = [];
let selectError: { message: string } | null = null;

vi.mock("@/lib/bingx/futures", () => ({
  queryFuturesOrder: (...a: unknown[]) => queryFuturesOrder(...a),
  queryFuturesFullOrder: (...a: unknown[]) => queryFuturesFullOrder(...a),
  getFuturesAllFillOrders: (...a: unknown[]) => getFuturesAllFillOrders(...a),
}));
vi.mock("@/lib/bingx/trade", () => ({
  queryOrder: (...a: unknown[]) => queryOrder(...a),
}));
vi.mock("@/lib/trading/api-key-cache", () => ({
  getDecryptedApiKeys: (...a: unknown[]) => getDecryptedApiKeys(...a),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      let pendingPatch: Record<string, unknown> | null = null;

      const chain = () => builder;
      builder.select = chain;
      builder.eq = (_col: string, val: string) => {
        // update(...).eq("id", ...) 是链条的末端，这里落账
        if (pendingPatch) {
          updates.push({ id: val, patch: pendingPatch });
          pendingPatch = null;
          return Promise.resolve({ error: null });
        }
        return builder;
      };
      builder.in = chain;
      builder.not = chain;
      builder.order = chain;
      builder.or = chain;
      builder.update = (patch: Record<string, unknown>) => {
        pendingPatch = patch;
        return builder;
      };
      builder.limit = chain;
      // supabase-js 的查询构造器本身是 thenable：链条可以在任何一环被 await，
      // 也可以继续加条件（reconcile 就是 .limit() 之后再 .or()）。
      // mock 必须保持这个性质，否则测出来的是 mock 的形状不是代码的行为。
      builder.then = (
        resolve: (v: { data: unknown[]; error: unknown }) => unknown
      ) => Promise.resolve({ data: selectRows, error: selectError }).then(resolve);
      return builder;
    },
  }),
}));

const { reconcileOrders } = await import("./reconcile");

const FUTURES_ROW = {
  id: "row-1",
  market_type: "futures",
  symbol: "BTC-USDT",
  bingx_order_id: "998877",
  status: "pending",
  created_at: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  updates.length = 0;
  selectRows = [];
  selectError = null;
  queryFuturesOrder.mockReset();
  queryFuturesFullOrder.mockReset();
  getFuturesAllFillOrders.mockReset();
  queryOrder.mockReset();
  getDecryptedApiKeys.mockReset();
  getDecryptedApiKeys.mockResolvedValue({ apiKey: "k", secret: "s" });
  getFuturesAllFillOrders.mockResolvedValue([]);
});

describe("reconcileOrders — futures", () => {
  it("reads the order out of the data.order wrapper and writes the fill back", async () => {
    selectRows = [FUTURES_ROW];
    queryFuturesOrder.mockResolvedValue({
      order: {
        symbol: "BTC-USDT",
        orderId: "998877",
        status: "FILLED",
        executedQty: "0.5",
        avgPrice: "64000",
        cumQuote: "32000",
      },
    });

    const res = await reconcileOrders("u1");

    expect(res).toEqual({ checked: 1, updated: 1, failed: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({
      status: "filled",
      executed_qty: 0.5,
      executed_price: 64000,
      total_value: 32000,
    });
  });

  it("sums commission from data.fill_orders and takes the asset from `currency`", async () => {
    selectRows = [FUTURES_ROW];
    queryFuturesOrder.mockResolvedValue({
      order: { status: "FILLED", executedQty: "0.5", avgPrice: "64000", cumQuote: "32000" },
    });
    // 一单两笔成交，commission 是负数
    getFuturesAllFillOrders.mockResolvedValue([
      { orderId: "998877", volume: "0.3", price: "64000", amount: "19200", commission: "-0.0096", currency: "USDT" },
      { orderId: "998877", volume: "0.2", price: "64000", amount: "12800", commission: "-0.0064", currency: "USDT" },
      { orderId: "111", volume: "1", price: "1", amount: "1", commission: "-9.99", currency: "USDT" },
    ]);

    await reconcileOrders("u1");

    expect(updates[0].patch.fee).toBeCloseTo(0.016, 8);
    expect(updates[0].patch.fee_asset).toBe("USDT");
  });

  it("queries fills once per symbol rather than once per order", async () => {
    selectRows = [
      FUTURES_ROW,
      { ...FUTURES_ROW, id: "row-2", bingx_order_id: "998878" },
      { ...FUTURES_ROW, id: "row-3", symbol: "ETH-USDT", bingx_order_id: "998879" },
    ];
    queryFuturesOrder.mockResolvedValue({
      order: { status: "FILLED", executedQty: "1", avgPrice: "10", cumQuote: "10" },
    });

    await reconcileOrders("u1");

    expect(getFuturesAllFillOrders).toHaveBeenCalledTimes(2);
  });

  it("falls back to fullOrder when the v2 query cannot find the order", async () => {
    selectRows = [FUTURES_ROW];
    queryFuturesOrder.mockRejectedValue(new Error("BingX error 80016: order not found"));
    queryFuturesFullOrder.mockResolvedValue({ order: { status: "CANCELED", executedQty: "0" } });

    const res = await reconcileOrders("u1");

    expect(queryFuturesFullOrder).toHaveBeenCalled();
    expect(updates[0].patch.status).toBe("canceled");
    expect(res.failed).toBe(0);
  });

  it("does not wipe an already-reconciled fill price when the exchange returns blanks", async () => {
    selectRows = [{ ...FUTURES_ROW, status: "partially_filled" }];
    queryFuturesOrder.mockResolvedValue({
      order: { status: "PARTIALLY_FILLED", executedQty: "", avgPrice: "", cumQuote: "" },
    });

    await reconcileOrders("u1");

    expect(updates[0].patch).not.toHaveProperty("executed_price");
    expect(updates[0].patch).not.toHaveProperty("executed_qty");
    expect(updates[0].patch.status).toBe("partially_filled");
  });

  it("still stamps last_synced_at for an order that can never be found again", async () => {
    selectRows = [FUTURES_ROW];
    queryFuturesOrder.mockRejectedValue(new Error("gone"));
    queryFuturesFullOrder.mockRejectedValue(new Error("gone"));

    const res = await reconcileOrders("u1");

    // 不盖时间戳的话，每次对账都会被这些查不到的单占满配额
    expect(updates[0].patch).toEqual({ last_synced_at: expect.any(String) });
    expect(res.failed).toBe(1);
  });
});

describe("reconcileOrders — spot", () => {
  it("derives the average fill price and keeps the fee the order object carries", async () => {
    selectRows = [{ ...FUTURES_ROW, market_type: "spot", symbol: "XRP-USDT" }];
    queryOrder.mockResolvedValue({
      status: "FILLED",
      executedQty: "10",
      cummulativeQuoteQty: "5",
      fee: "-0.01",
      feeAsset: "XRP",
    });

    await reconcileOrders("u1");

    expect(updates[0].patch).toMatchObject({
      status: "filled",
      executed_qty: 10,
      executed_price: 0.5,
      total_value: 5,
      fee: 0.01,
      fee_asset: "XRP",
    });
    // 现货的手续费在订单对象里，不该再去查合约的成交明细接口
    expect(getFuturesAllFillOrders).not.toHaveBeenCalled();
  });
});

describe("reconcileOrders — guards", () => {
  it("does nothing when the user has no API key", async () => {
    selectRows = [FUTURES_ROW];
    getDecryptedApiKeys.mockResolvedValue(null);

    const res = await reconcileOrders("u1");

    expect(res).toEqual({ checked: 0, updated: 0, failed: 0 });
    expect(updates).toHaveLength(0);
  });

  it("returns an empty result instead of throwing when the table read fails", async () => {
    selectError = { message: "boom" };

    const res = await reconcileOrders("u1");

    expect(res).toEqual({ checked: 0, updated: 0, failed: 0 });
  });

  it("leaves a still-open order in pending", async () => {
    selectRows = [FUTURES_ROW];
    queryFuturesOrder.mockResolvedValue({ order: { status: "NEW", executedQty: "0" } });

    const res = await reconcileOrders("u1");

    expect(updates[0].patch.status).toBe("pending");
    expect(res.updated).toBe(0);
  });
});
