import { describe, it, expect } from "vitest";
import { planAlerts, signedPct, type OpenAlert } from "./alerts";
import { ALERT_CLOSE_STREAK } from "./types";
import type { ScannerRow } from "./types";
import type { Scenario } from "./factors/scenario";

function row(overrides: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { oi: 25, cvd: 14 },
    scenario: null,
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

/** 默认健康趋势/long——八格判定表里最常见的一格，跟 scenario.test.ts 的口径一致。 */
function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    kind: "healthy_trend",
    direction: "long",
    trap: false,
    swingPrev: 90,
    swingNow: 100,
    cvdPct: 3,
    oiPct: 2,
    side: "high",
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
    scenario: scenario(),
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

  it("manage 不翻号：上涨是正数，跟 long 的算法一样", () => {
    expect(signedPct(100, 110, "manage")).toBeCloseTo(10);
  });

  it("manage 不翻号：下跌是负数，不会像 short 那样被翻成正数", () => {
    expect(signedPct(100, 90, "manage")).toBeCloseTo(-10);
  });
});

describe("planAlerts · 触发 = 检测到场景", () => {
  it("本轮出现场景时开一条新警报", () => {
    const plan = planAlerts([row({ scenario: scenario() })], []);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].triggerPrice).toBe(100);
    expect(plan.opens[0].scenario.kind).toBe("healthy_trend");
    expect(plan.opens[0].direction).toBe("long");
  });

  it("无场景不开警报——total 再高也不算数，判据已经不是总分", () => {
    expect(planAlerts([row({ total: 99, scenario: null })], []).opens).toHaveLength(0);
  });

  it("开警报时把当轮总分/因子构成一并记下来，供事后复盘（不是触发判据）", () => {
    const plan = planAlerts([row({ scenario: scenario(), total: 42, factors: { oi: 20, cvd: 10 } })], []);
    expect(plan.opens[0].triggerScore).toBe(42);
    expect(plan.opens[0].factors).toEqual({ oi: 20, cvd: 10 });
  });
});

describe("planAlerts · 同一场景（kind 相同）只更新，不重复开", () => {
  it("已有未平警报时不重复开", () => {
    const plan = planAlerts([row({ scenario: scenario() })], [open()]);
    expect(plan.opens).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
  });

  it("同方向更新时刷新实时价并把 belowCount 归零", () => {
    const plan = planAlerts(
      [row({ scenario: scenario(), price: 110 })],
      [open({ belowCount: 2 })]
    );
    expect(plan.updates[0].lastPrice).toBe(110);
    expect(plan.updates[0].belowCount).toBe(0);
  });

  it("peakPct 只涨不跌——它记的是触发以来的最好成绩", () => {
    const plan = planAlerts([row({ scenario: scenario(), price: 105 })], [open({ peakPct: 20 })]);
    expect(plan.updates[0].peakPct).toBe(20);
  });

  it("刷新更高的 peakPct", () => {
    const plan = planAlerts([row({ scenario: scenario(), price: 130 })], [open({ peakPct: 20 })]);
    expect(plan.updates[0].peakPct).toBeCloseTo(30);
  });

  it("manage 场景更新 peakPct 时不翻号", () => {
    const manageScenario = scenario({ kind: "inventory_flush", direction: "manage" });
    const plan = planAlerts(
      [row({ scenario: manageScenario, price: 90, direction: "long" })],
      [open({ scenario: manageScenario, direction: "long", triggerPrice: 100, peakPct: 0 })]
    );
    // 价格从 100 跌到 90，manage 不翻号，累计是 -10 而不是 +10。
    expect(plan.updates[0].peakPct).toBeCloseTo(0); // 只涨不跌：-10 不如初始的 0 好，维持 0
  });

  it("把这一轮最新的场景判定写回去（cvdPct/oiPct 等字段会刷新）", () => {
    const fresh = scenario({ cvdPct: 5.5, oiPct: 3.3 });
    const plan = planAlerts([row({ scenario: fresh })], [open({ scenario: scenario({ cvdPct: 3, oiPct: 2 }) })]);
    expect(plan.updates[0].scenario.cvdPct).toBeCloseTo(5.5);
    expect(plan.updates[0].scenario.oiPct).toBeCloseTo(3.3);
  });
});

describe("planAlerts · 场景变了（kind 不同）立即换", () => {
  it("kind 变了立即关掉旧的、开一条新的", () => {
    const plan = planAlerts(
      [row({ scenario: scenario({ kind: "true_top_div", direction: "short", side: "high" }), direction: "short" })],
      [open({ scenario: scenario({ kind: "healthy_trend", direction: "long" }), direction: "long" })]
    );
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].scenario.kind).toBe("true_top_div");
    expect(plan.opens[0].direction).toBe("short");
  });

  it("没有缓冲区——kind 一变就是新事件，不像旧的分数迟滞那样等一等", () => {
    const plan = planAlerts(
      [row({ scenario: scenario({ kind: "inventory_flush", direction: "manage" }) })],
      [open({ scenario: scenario({ kind: "healthy_trend", direction: "long" }) })]
    );
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
  });
});

describe("planAlerts · 场景消失（变成 null）要连续 3 轮才关", () => {
  it("场景消失一次只累计 belowCount，不关闭，也不清空已记录的场景", () => {
    const plan = planAlerts([row({ scenario: null })], [open({ belowCount: 0 })]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].belowCount).toBe(1);
    // 场景消失这一轮拿不到新场景，保留上一次已知的（不清空）。
    expect(plan.updates[0].scenario.kind).toBe("healthy_trend");
  });

  it("连续达到 ALERT_CLOSE_STREAK 轮场景缺席才真的关闭", () => {
    const plan = planAlerts(
      [row({ scenario: null })],
      [open({ belowCount: ALERT_CLOSE_STREAK - 1 })]
    );
    expect(plan.closes).toEqual(["a1"]);
  });

  it("场景消失又在窗口内恢复：belowCount 归零重新开始累计", () => {
    // 消失、消失、恢复（归零）、消失、消失、消失 —— 第 6 轮才刚好累计到 3 而关闭。
    let state = [open({ belowCount: 0 })];
    const scenarios: (Scenario | null)[] = [null, null, scenario(), null, null, null];
    const closesByRound: boolean[] = [];
    for (const sc of scenarios) {
      const plan = planAlerts([row({ scenario: sc })], state);
      closesByRound.push(plan.closes.length > 0);
      if (plan.closes.length > 0) break;
      expect(plan.opens).toHaveLength(0);
      state = [
        {
          ...state[0],
          belowCount: plan.updates[0].belowCount,
          scenario: plan.updates[0].scenario,
        },
      ];
    }
    expect(closesByRound).toEqual([false, false, false, false, false, true]);
  });

  it("这一轮扫描里整个消失的币，警报保持原样不动", () => {
    // 币掉出候选池不等于场景消失——那一刻我们连它的场景都没有，
    // 不能按「场景 null」处理，必须原样保留。
    const plan = planAlerts([], [open()]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.opens).toHaveLength(0);
  });
});

describe("planAlerts · 多币场景不互相干扰", () => {
  it("一个触发、一个同 kind 更新、一个场景缺席满 3 轮被关闭", () => {
    const plan = planAlerts(
      [
        row({ symbol: "AAA-USDT", scenario: scenario() }),
        row({ symbol: "BBB-USDT", scenario: scenario(), price: 120 }),
        row({ symbol: "CCC-USDT", scenario: null }),
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

  it("同一个币残留了两条 kind 不同的未平警报时，不会再重复开一条", () => {
    // 落库层若在场景切换时留下中间状态就会出现这种输入：一条同 kind
    // 会被 update，另一条 kind 不同的会被关闭，但绝不能再新开一条。
    const plan = planAlerts(
      [row({ scenario: scenario({ kind: "healthy_trend", direction: "long" }) })],
      [
        open({ id: "long-one", scenario: scenario({ kind: "healthy_trend", direction: "long" }) }),
        open({ id: "short-one", scenario: scenario({ kind: "true_top_div", direction: "short" }) }),
      ]
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["long-one"]);
    expect(plan.closes).toEqual(["short-one"]);
    expect(plan.opens).toHaveLength(0);
  });
});
