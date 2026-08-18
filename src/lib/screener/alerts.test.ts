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

  it("回到迟滞区间以上会让 belowCount 归零、重新开始累计", () => {
    // 74,74 累计到 2；77 落在迟滞区间 [75,80) 内，把计数归零；
    // 再来 74,74,74 才刚好在第 6 轮累计到 3 而关闭。
    //
    // 第 3 轮必须选一个落在 [ALERT_CLOSE_SCORE, ALERT_TRIGGER_SCORE) =
    // [75, 80) 之间的值（这里用 77），不能用 ≥80 的值：如果用 81 这种
    // 同时 ≥75 也 ≥80 的值，不管归零条件写成 `< ALERT_CLOSE_SCORE(75)`
    // 还是被误写成 `< ALERT_TRIGGER_SCORE(80)`，第 3 轮都会归零，两种
    // 实现产生完全相同的 close 模式，用例就测不出这类错误——上一版就是
    // 踩了这个坑。用 77：正确实现里 77 不小于 75 所以归零；误写成 <80
    // 的实现里 77<80 会继续累计，第 3 轮就提前关闭，与正确实现在第 3
    // 轮就产生分歧。
    let state = [open({ belowCount: 0 })];
    const rounds = [74, 74, 77, 74, 74, 74];
    const closesByRound: boolean[] = [];
    for (const total of rounds) {
      const plan = planAlerts([row({ total })], state);
      closesByRound.push(plan.closes.length > 0);
      if (plan.closes.length > 0) break;
      expect(plan.opens).toHaveLength(0);
      state = [open({ belowCount: plan.updates[0].belowCount })];
    }
    expect(closesByRound).toEqual([false, false, false, false, false, true]);
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

  it("多个币互不干扰——一个触发、一个更新、一个关闭", () => {
    const plan = planAlerts(
      [
        row({ symbol: "AAA-USDT", total: 88 }),
        row({ symbol: "BBB-USDT", total: 90, price: 120 }),
        row({ symbol: "CCC-USDT", total: 70 }),
      ],
      [
        open({ id: "b", symbol: "BBB-USDT" }),
        open({ id: "c", symbol: "CCC-USDT", belowCount: ALERT_CLOSE_STREAK - 1 }),
      ]
    );
    expect(plan.opens.map((o) => o.symbol)).toEqual(["AAA-USDT"]);
    expect(plan.updates.map((u) => u.id)).toEqual(["b"]);
    expect(plan.closes).toEqual(["c"]);
  });

  it("同一个币残留了两条方向相反的未平警报时，不会再重复开一条", () => {
    // 落库层若在方向翻转时留下中间状态就会出现这种输入。
    // 同方向那条会被 update，反方向那条会被关闭，但绝不能再新开一条。
    const plan = planAlerts(
      [row({ direction: "long", total: 88 })],
      [
        open({ id: "long-one", direction: "long" }),
        open({ id: "short-one", direction: "short" }),
      ]
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["long-one"]);
    expect(plan.closes).toEqual(["short-one"]);
    expect(plan.opens).toHaveLength(0);
  });
});
