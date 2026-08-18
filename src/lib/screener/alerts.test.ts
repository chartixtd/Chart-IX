import { describe, it, expect } from "vitest";
import { planAlerts, signedPct, type OpenAlert } from "./alerts";
import { ALERT_CLOSE_STREAK } from "./types";
import type { ScannerRow } from "./types";

function row(overrides: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { zone: 28, sweep: 18, oi: 25, cvd: 14 },
    price: 100,
    change24h: 1,
    amplitude: 4,
    volumeUsd: 20_000_000,
    marketCap: 300_000_000,
    marketCapRank: 120,
    fundingRate: 0.0001,
    sourceExchange: "Binance",
    ...overrides,
  };
}

function open(overrides: Partial<OpenAlert> = {}): OpenAlert {
  return {
    id: "a1",
    symbol: "TIA-USDT",
    direction: "long",
    triggerPrice: 100,
    peakPct: 0,
    belowCount: 0,
    ...overrides,
  };
}

describe("signedPct", () => {
  it("做多上涨是正收益", () => {
    expect(signedPct(100, 110, "long")).toBeCloseTo(10);
  });

  it("做空下跌是正收益——方向要取符号，否则警报卡会把赚钱显示成亏钱", () => {
    expect(signedPct(100, 90, "short")).toBeCloseTo(10);
  });

  it("做空上涨是负收益", () => {
    expect(signedPct(100, 110, "short")).toBeCloseTo(-10);
  });
});

describe("planAlerts", () => {
  it("总分首次达到触发线时开一条新警报", () => {
    const plan = planAlerts([row({ total: 80 })], []);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].triggerPrice).toBe(100);
    expect(plan.opens[0].triggerScore).toBe(80);
  });

  it("未达触发线不开警报", () => {
    expect(planAlerts([row({ total: 79 })], []).opens).toHaveLength(0);
  });

  it("已有未平警报时不重复开——这是「首次突破」的全部含义", () => {
    const plan = planAlerts([row({ total: 92 })], [open()]);
    expect(plan.opens).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
  });

  it("同方向更新时刷新实时价并把 belowCount 归零", () => {
    const plan = planAlerts([row({ total: 90, price: 110 })], [open({ belowCount: 2 })]);
    expect(plan.updates[0].lastPrice).toBe(110);
    expect(plan.updates[0].belowCount).toBe(0);
  });

  it("peakPct 只涨不跌——它记的是触发以来的最好成绩", () => {
    const plan = planAlerts([row({ price: 105 })], [open({ peakPct: 20 })]);
    expect(plan.updates[0].peakPct).toBe(20);
  });

  it("刷新更高的 peakPct", () => {
    const plan = planAlerts([row({ price: 130 })], [open({ peakPct: 20 })]);
    expect(plan.updates[0].peakPct).toBeCloseTo(30);
  });

  it("分数落在触发线与关闭线之间时保持未平且不累计——这就是迟滞区间", () => {
    const plan = planAlerts([row({ total: 77 })], [open({ belowCount: 2 })]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates[0].belowCount).toBe(0);
  });

  it("低于关闭线一次只累计，不关闭", () => {
    const plan = planAlerts([row({ total: 70 })], [open({ belowCount: 0 })]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates[0].belowCount).toBe(1);
  });

  it("连续低于关闭线达到迟滞次数才关闭", () => {
    const plan = planAlerts([row({ total: 70 })], [open({ belowCount: ALERT_CLOSE_STREAK - 1 })]);
    expect(plan.closes).toEqual(["a1"]);
  });

  it("在 80 线上抖动不会反复开关警报", () => {
    let state = [open({ belowCount: 0 })];
    // 79 → 81 → 78 → 82，四轮下来既没关闭也没新开
    for (const total of [79, 81, 78, 82]) {
      const plan = planAlerts([row({ total })], state);
      expect(plan.closes).toHaveLength(0);
      expect(plan.opens).toHaveLength(0);
      state = [open({ belowCount: plan.updates[0].belowCount })];
    }
  });

  it("方向翻转时关掉旧的、开一条新的", () => {
    const plan = planAlerts([row({ direction: "short", total: 88 })], [open({ direction: "long" })]);
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].direction).toBe("short");
  });

  it("方向翻转但新方向没达到触发线时只关不开", () => {
    const plan = planAlerts([row({ direction: "short", total: 60 })], [open({ direction: "long" })]);
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(0);
  });

  it("这一轮扫描里整个消失的币，警报保持原样不动", () => {
    // 币掉出候选池（成交量萎缩等）不等于信号失效，更不等于价格数据可信。
    // 强行按「缺席」关闭会在池子边缘反复误关。
    const plan = planAlerts([], [open()]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.opens).toHaveLength(0);
  });
});
