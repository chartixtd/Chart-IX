import { describe, it, expect } from "vitest";
import { computePositionSize, FOREX_PAIRS, LOT_SIZE } from "./position-size";

/** 参照计算器的实测基准输入（见设计文档「已确认的现状事实」）。 */
const BASE = {
  assetClass: "stocks",
  direction: "long",
  accountBalance: 10000,
  riskMode: "percent",
  riskPercent: 2,
  entryPrice: 50,
  stopMode: "price",
  stopPrice: 48,
  leverage: 1,
} as const;

describe("computePositionSize — 参照计算器的实测基准", () => {
  it("复现实测的那一组数字，一个都不能差", () => {
    const r = computePositionSize(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toBeCloseTo(100, 6);
    expect(r.positionValue).toBeCloseTo(5000, 6);
    expect(r.requiredMargin).toBeCloseTo(5000, 6);
    expect(r.riskAmount).toBeCloseTo(200, 6);
    expect(r.stopDistance).toBeCloseTo(2, 6);
    expect(r.stopDistancePct).toBeCloseTo(4, 6);
    expect(r.accountRiskPct).toBeCloseTo(2, 6);
    expect(r.positionRiskPct).toBeCloseTo(4, 6);
    expect(r.marginUsedPct).toBeCloseTo(50, 6);
    expect(r.maxLosses).toBe(50);
  });

  it("杠杆 1:10 + 风险 6% → 保证金占用 15%（实测值）", () => {
    const r = computePositionSize({ ...BASE, riskPercent: 6, leverage: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toBeCloseTo(300, 6);
    expect(r.positionValue).toBeCloseTo(15000, 6);
    expect(r.marginUsedPct).toBeCloseTo(15, 6);
    expect(r.maxLosses).toBe(16);
  });

  it("做空与做多得出相同数量——止损距离取绝对值", () => {
    const long = computePositionSize(BASE);
    const short = computePositionSize({
      ...BASE, direction: "short", entryPrice: 48, stopPrice: 50,
    });
    expect(long.ok && short.ok).toBe(true);
    if (!long.ok || !short.ok) return;
    expect(short.units).toBeCloseTo(long.units, 6);
  });

  it("风险按金额输入时忽略百分比", () => {
    const r = computePositionSize({
      ...BASE, riskMode: "amount", riskAmount: 500, riskPercent: 999,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskAmount).toBeCloseTo(500, 6);
    expect(r.units).toBeCloseTo(250, 6);
    expect(r.accountRiskPct).toBeCloseTo(5, 6);
  });
});

describe("风险档位（实测扫描确定的阈值）", () => {
  const bandAt = (riskPercent: number) => {
    const r = computePositionSize({ ...BASE, riskPercent });
    return r.ok ? r.riskBand : "invalid";
  };

  it("五档边界逐个对上", () => {
    expect(bandAt(0.5)).toBe("very-conservative");
    expect(bandAt(1)).toBe("very-conservative");
    expect(bandAt(1.01)).toBe("conservative");
    expect(bandAt(2)).toBe("conservative");
    expect(bandAt(2.01)).toBe("moderate");
    expect(bandAt(3)).toBe("moderate");
    expect(bandAt(3.01)).toBe("high");
    expect(bandAt(5)).toBe("high");
    expect(bandAt(5.01)).toBe("very-high");
    expect(bandAt(12)).toBe("very-high");
  });
});

describe("外汇", () => {
  it("EUR/USD：用参照页面自己的例子（$50 风险、50 点）得出 0.1 手", () => {
    const r = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 5000,
      riskMode: "percent", riskPercent: 1,
      entryPrice: 1.0850, stopMode: "price", stopPrice: 1.0800,
      leverage: 1, forexPair: "EUR/USD",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskAmount).toBeCloseTo(50, 6);
    expect(r.units).toBeCloseTo(10000, 4);
    expect(r.lots).toBeCloseTo(0.1, 6);
    expect(r.positionValue).toBeCloseTo(10850, 4);
  });

  it("USD/JPY：报价币不是美元，点值随入场价变化", () => {
    const r = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 10000,
      riskMode: "amount", riskAmount: 200,
      entryPrice: 150, stopMode: "price", stopPrice: 149.5,
      leverage: 1, forexPair: "USD/JPY",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 每单位风险 = 0.5 JPY × (1/150) = 0.003333 USD → 200/0.003333 = 60000 单位
    expect(r.units).toBeCloseTo(60000, 2);
    expect(r.lots).toBeCloseTo(0.6, 4);
    // 基础币就是美元，所以仓位价值等于单位数
    expect(r.positionValue).toBeCloseTo(60000, 2);
  });

  it("日元报价的币对点大小是 0.01，其余是 0.0001", () => {
    expect(FOREX_PAIRS["USD/JPY"].pipSize).toBe(0.01);
    expect(FOREX_PAIRS["EUR/USD"].pipSize).toBe(0.0001);
  });

  it("止损按点数输入，与按价格输入等价", () => {
    const byPrice = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 5000,
      riskMode: "percent", riskPercent: 1,
      entryPrice: 1.0850, stopMode: "price", stopPrice: 1.0800,
      leverage: 1, forexPair: "EUR/USD",
    });
    const byPips = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 5000,
      riskMode: "percent", riskPercent: 1,
      entryPrice: 1.0850, stopMode: "pips", stopPips: 50,
      leverage: 1, forexPair: "EUR/USD",
    });
    expect(byPrice.ok && byPips.ok).toBe(true);
    if (!byPrice.ok || !byPips.ok) return;
    expect(byPips.units).toBeCloseTo(byPrice.units, 4);
  });

  it("一标准手是 10 万单位", () => {
    expect(LOT_SIZE).toBe(100_000);
  });
});

describe("期货合约乘数", () => {
  it("乘数放大每点价值，因而压低合约数", () => {
    const r = computePositionSize({
      assetClass: "futures", direction: "long", accountBalance: 10000,
      riskMode: "amount", riskAmount: 500,
      entryPrice: 4500, stopMode: "price", stopPrice: 4490,
      leverage: 1, contractMultiplier: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 每单位风险 = 10 点 × 50 = $500 → 正好 1 张
    expect(r.units).toBeCloseTo(1, 6);
    expect(r.positionValue).toBeCloseTo(225000, 4);
  });
});

describe("高级项", () => {
  it("止盈给出盈亏比与预期盈利", () => {
    const r = computePositionSize({ ...BASE, takeProfitPrice: 56 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskRewardRatio).toBeCloseTo(3, 6);   // 6 / 2
    expect(r.expectedProfit).toBeCloseTo(600, 6);  // 100 股 × $6
  });

  it("不填止盈时不产生盈亏比", () => {
    const r = computePositionSize(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskRewardRatio).toBeNull();
    expect(r.expectedProfit).toBeNull();
  });

  it("手续费与滑点抬高每单位风险，压低数量", () => {
    const plain = computePositionSize(BASE);
    const withCost = computePositionSize({ ...BASE, feePercent: 0.1, slippage: 0.05 });
    expect(plain.ok && withCost.ok).toBe(true);
    if (!plain.ok || !withCost.ok) return;
    expect(withCost.units).toBeLessThan(plain.units);
    // 每单位风险 = (2 + 0.05) × 1 + (50+48) × 0.001 = 2.05 + 0.098 = 2.148
    expect(withCost.units).toBeCloseTo(200 / 2.148, 4);
  });

  it("两项都为 0 时与不填完全一致", () => {
    const plain = computePositionSize(BASE);
    const zero = computePositionSize({ ...BASE, feePercent: 0, slippage: 0 });
    expect(plain.ok && zero.ok).toBe(true);
    if (!plain.ok || !zero.ok) return;
    expect(zero.units).toBeCloseTo(plain.units, 10);
  });
});

describe("无效输入", () => {
  it("入场价与止损价相同 → 拒绝，不产生 Infinity", () => {
    const r = computePositionSize({ ...BASE, stopPrice: 50 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("stop-distance-zero");
  });

  it("余额为 0 或负 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, accountBalance: 0 }).ok).toBe(false);
    expect(computePositionSize({ ...BASE, accountBalance: -1 }).ok).toBe(false);
  });

  it("入场价为 0 或负 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, entryPrice: 0 }).ok).toBe(false);
  });

  it("风险为 0 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, riskPercent: 0 }).ok).toBe(false);
  });

  it("杠杆小于 1 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, leverage: 0 }).ok).toBe(false);
  });

  it("非有限数 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, entryPrice: NaN }).ok).toBe(false);
  });
});
