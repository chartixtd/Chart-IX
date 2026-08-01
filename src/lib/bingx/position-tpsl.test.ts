import { describe, it, expect, vi, beforeEach } from "vitest";

const signedRequest = vi.fn();

vi.mock("./signed-request", () => ({
  signedRequest: (...args: unknown[]) => signedRequest(...args),
}));

const { setPositionTpSl } = await import("./futures");

/** 只取"下单"那几次调用（跳过撤单前的 openOrders 查询/撤单本身），按调用顺序取第 n 次 */
function orderPlacementCalls() {
  return signedRequest.mock.calls.filter(
    (call) => call[2] === "POST" && call[3] === "/openApi/swap/v2/trade/order"
  );
}
function callAt(n: number) {
  const [, , , path, body] = orderPlacementCalls()[n];
  return { path, body: body as Record<string, string | number> };
}

beforeEach(() => {
  signedRequest.mockReset();
  // 默认：openOrders 查询返回空列表（没有上次挂的同 ID 旧单，不触发撤单），
  // 其它任何调用（下单/撤单）都返回一个通用的成功响应
  signedRequest.mockImplementation(async (..._args: unknown[]) => {
    const [, , method, path] = _args as [string, string, string, string];
    if (method === "GET" && path === "/openApi/swap/v2/trade/openOrders") {
      return { orders: [] };
    }
    return { order: { orderId: "1" } };
  });
});

describe("setPositionTpSl endpoint choice", () => {
  it("places orders through the normal order endpoint, never positionTpSl", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT",
      positionSide: "LONG",
      takeProfitPrice: "80",
      dualSide: true,
    });

    // 1 次 openOrders 查询 + 1 次下单
    expect(signedRequest).toHaveBeenCalledTimes(2);
    expect(orderPlacementCalls()).toHaveLength(1);
    expect(callAt(0).path).toBe("/openApi/swap/v2/trade/order");
    // 这个端点不存在，走它必然返回参数错误
    for (const call of signedRequest.mock.calls) {
      expect(call[3]).not.toContain("positionTpSl");
    }
  });

  it("does not call the API at all when neither price is given", async () => {
    await setPositionTpSl("k", "s", { symbol: "SOL-USDT", positionSide: "LONG" });
    expect(signedRequest).not.toHaveBeenCalled();
  });
});

describe("setPositionTpSl order shape", () => {
  it("uses TAKE_PROFIT_MARKET for TP and STOP_MARKET for SL", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT",
      positionSide: "LONG",
      takeProfitPrice: "80",
      stopLossPrice: "70",
      dualSide: true,
    });

    expect(orderPlacementCalls()).toHaveLength(2);
    expect(callAt(0).body).toMatchObject({ type: "TAKE_PROFIT_MARKET", stopPrice: "80" });
    expect(callAt(1).body).toMatchObject({ type: "STOP_MARKET", stopPrice: "70" });
  });

  it("closes the whole position with mark-price triggers", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT",
      positionSide: "LONG",
      stopLossPrice: "70",
      dualSide: true,
    });

    expect(callAt(0).body).toMatchObject({
      closePosition: "true",
      workingType: "MARK_PRICE",
    });
  });
});

describe("setPositionTpSl close direction", () => {
  it("sells to close a long position", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", stopLossPrice: "70", dualSide: true,
    });
    expect(callAt(0).body.side).toBe("SELL");
  });

  it("buys to close a short position", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "SHORT", stopLossPrice: "90", dualSide: true,
    });
    expect(callAt(0).body.side).toBe("BUY");
  });
});

describe("setPositionTpSl position mode handling", () => {
  // 这是 502「订单参数不合法」的真实成因：单向模式下必须传 BOTH
  it("sends positionSide BOTH in one-way mode", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", stopLossPrice: "70", dualSide: false,
    });
    expect(callAt(0).body.positionSide).toBe("BOTH");
  });

  it("still sells to close a long position in one-way mode", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", stopLossPrice: "70", dualSide: false,
    });
    // 方向由实际持仓决定，不受 BOTH 影响
    expect(callAt(0).body.side).toBe("SELL");
  });

  it("still buys to close a short position in one-way mode", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "SHORT", stopLossPrice: "90", dualSide: false,
    });
    expect(callAt(0).body.side).toBe("BUY");
    expect(callAt(0).body.positionSide).toBe("BOTH");
  });

  it("keeps LONG/SHORT in hedge mode", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "SHORT", stopLossPrice: "90", dualSide: true,
    });
    expect(callAt(0).body.positionSide).toBe("SHORT");
  });
});

// 回归测试：修复"下单之后没法再改止盈止损"——之前每次调用都无条件挂新单，
// 第二次设置要么被 BingX 拒绝、要么静默叠加一张旧单不动的问题
describe("setPositionTpSl replaces the previous order instead of stacking a new one", () => {
  it("cancels the previously-tagged TP order before placing the new one", async () => {
    signedRequest.mockImplementation(async (..._args: unknown[]) => {
      const [, , method, path] = _args as [string, string, string, string];
      if (method === "GET" && path === "/openApi/swap/v2/trade/openOrders") {
        return {
          orders: [
            { orderId: "999", symbol: "SOL-USDT", clientOrderId: "cix-tpsl-tp-long-SOLUSDT", type: "TAKE_PROFIT_MARKET" },
          ],
        };
      }
      return { order: { orderId: "1" } };
    });

    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", takeProfitPrice: "85", dualSide: true,
    });

    const cancelCall = signedRequest.mock.calls.find(
      (call) => call[2] === "DELETE" && call[3] === "/openApi/swap/v2/trade/order"
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.[4]).toMatchObject({ symbol: "SOL-USDT", orderId: "999" });
    // 撤销必须发生在挂新单之前，不然会撞上"同一个 clientOrderId 仍然有效"的限制
    const cancelIndex = signedRequest.mock.calls.indexOf(cancelCall!);
    const placeIndex = signedRequest.mock.calls.findIndex(
      (call) => call[2] === "POST" && call[3] === "/openApi/swap/v2/trade/order"
    );
    expect(cancelIndex).toBeLessThan(placeIndex);
  });

  it("does not cancel anything when there is no previously-tagged order open", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", takeProfitPrice: "85", dualSide: true,
    });
    const cancelCall = signedRequest.mock.calls.find((call) => call[2] === "DELETE");
    expect(cancelCall).toBeUndefined();
  });

  it("never cancels an order that this feature didn't tag itself (e.g. a conditional order the user placed manually)", async () => {
    signedRequest.mockImplementation(async (..._args: unknown[]) => {
      const [, , method, path] = _args as [string, string, string, string];
      if (method === "GET" && path === "/openApi/swap/v2/trade/openOrders") {
        return {
          orders: [
            { orderId: "555", symbol: "SOL-USDT", clientOrderId: "my-own-manually-placed-stop", type: "STOP_MARKET" },
          ],
        };
      }
      return { order: { orderId: "1" } };
    });

    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", stopLossPrice: "70", dualSide: true,
    });

    const cancelCall = signedRequest.mock.calls.find((call) => call[2] === "DELETE");
    expect(cancelCall).toBeUndefined();
  });

  it("tags the placed leg with a deterministic clientOrderId scoped to symbol/side/leg", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "LONG", takeProfitPrice: "85", dualSide: true,
    });
    expect(callAt(0).body.clientOrderId).toBe("cix-tpsl-tp-long-SOLUSDT");
  });

  it("uses a different clientOrderId for SHORT so LONG/SHORT legs on the same symbol never collide", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT", positionSide: "SHORT", stopLossPrice: "90", dualSide: true,
    });
    expect(callAt(0).body.clientOrderId).toBe("cix-tpsl-sl-short-SOLUSDT");
  });
});
