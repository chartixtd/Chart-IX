import { describe, it, expect } from "vitest";
import { evaluateAlerts, type PendingAlert } from "./evaluate";

const alert = (over: Partial<PendingAlert> = {}): PendingAlert => ({
  id: "a1",
  userId: "u1",
  symbol: "BTC-USDT",
  targetPrice: 70000,
  direction: "above",
  ...over,
});

describe("evaluateAlerts", () => {
  it("价格突破上方目标价时触发", () => {
    expect(evaluateAlerts([alert()], { "BTC-USDT": 70001 })).toHaveLength(1);
  });

  it("价格未达上方目标价时不触发", () => {
    expect(evaluateAlerts([alert()], { "BTC-USDT": 69999 })).toHaveLength(0);
  });

  it("价格正好等于上方目标价时触发", () => {
    expect(evaluateAlerts([alert()], { "BTC-USDT": 70000 })).toHaveLength(1);
  });

  it("价格跌破下方目标价时触发", () => {
    const a = alert({ direction: "below", targetPrice: 60000 });
    expect(evaluateAlerts([a], { "BTC-USDT": 59999 })).toHaveLength(1);
  });

  it("价格高于下方目标价时不触发", () => {
    const a = alert({ direction: "below", targetPrice: 60000 });
    expect(evaluateAlerts([a], { "BTC-USDT": 60001 })).toHaveLength(0);
  });

  it("价格正好等于下方目标价时触发", () => {
    const a = alert({ direction: "below", targetPrice: 60000 });
    expect(evaluateAlerts([a], { "BTC-USDT": 60000 })).toHaveLength(1);
  });

  it("拿不到该币种价格时跳过——宁可晚一分钟，不可误判", () => {
    expect(evaluateAlerts([alert()], {})).toHaveLength(0);
    expect(evaluateAlerts([alert()], { "ETH-USDT": 3000 })).toHaveLength(0);
  });

  it("价格为 NaN 或非有限值时跳过", () => {
    expect(evaluateAlerts([alert()], { "BTC-USDT": Number.NaN })).toHaveLength(0);
    expect(evaluateAlerts([alert()], { "BTC-USDT": Number.POSITIVE_INFINITY })).toHaveLength(0);
  });

  it("同一批里多个提醒各自独立判定", () => {
    const alerts = [
      alert({ id: "a1", symbol: "BTC-USDT", targetPrice: 70000, direction: "above" }),
      alert({ id: "a2", symbol: "ETH-USDT", targetPrice: 4000, direction: "below" }),
      alert({ id: "a3", symbol: "SOL-USDT", targetPrice: 200, direction: "above" }),
    ];
    const triggered = evaluateAlerts(alerts, {
      "BTC-USDT": 70500,
      "ETH-USDT": 4100,
      "SOL-USDT": 250,
    });
    expect(triggered.map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("空输入返回空数组", () => {
    expect(evaluateAlerts([], { "BTC-USDT": 70000 })).toEqual([]);
  });
});
