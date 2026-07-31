import { describe, it, expect, vi, beforeEach } from "vitest";

const signedRequest = vi.fn();

vi.mock("./signed-request", () => ({
  signedRequest: (...args: unknown[]) => signedRequest(...args),
}));

const { setPositionTpSl } = await import("./futures");

/** 取出第 n 次调用发给 BingX 的 (path, body) */
function callAt(n: number) {
  const [, , , path, body] = signedRequest.mock.calls[n];
  return { path, body: body as Record<string, string | number> };
}

beforeEach(() => {
  signedRequest.mockReset().mockResolvedValue({ order: { orderId: "1" } });
});

describe("setPositionTpSl endpoint choice", () => {
  it("places orders through the normal order endpoint, never positionTpSl", async () => {
    await setPositionTpSl("k", "s", {
      symbol: "SOL-USDT",
      positionSide: "LONG",
      takeProfitPrice: "80",
      dualSide: true,
    });

    expect(signedRequest).toHaveBeenCalledTimes(1);
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

    expect(signedRequest).toHaveBeenCalledTimes(2);
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
