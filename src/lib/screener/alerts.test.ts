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

describe("planAlerts · 同一场景（kind+direction+side 三者都相同）只更新，不重复开", () => {
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
    // 同一场景分支写回去的是非空 Scenario（AlertUpdate.scenario 的类型是
    // Scenario | null 是为了老实反映"场景消失"那条分支，这里不是那条分支）。
    expect(plan.updates[0].scenario).not.toBeNull();
    expect(plan.updates[0].scenario?.cvdPct).toBeCloseTo(5.5);
    expect(plan.updates[0].scenario?.oiPct).toBeCloseTo(3.3);
  });
});

describe("planAlerts · 场景变了（不是同一个场景）立即换", () => {
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

  // 评审 F1：只比 kind 会漏掉"同一个 kind、方向/侧翻了"这种实质上的方向
  // 反转——healthy_trend 高点侧是 long，低点侧是 short，两者 kind 相同但
  // 方向相反；如果只比 kind，这种翻侧会被误判成"同一场景"走 update 分支，
  // 把翻侧前后两套不可比较的符号混进同一个 peakPct 的 Math.max 里。
  it("同一个 kind 但从高点侧翻到低点侧（方向也跟着反转）：必须当成不同场景，立即关旧开新", () => {
    const highLong = scenario({ kind: "healthy_trend", direction: "long", side: "high" });
    const lowShort = scenario({ kind: "healthy_trend", direction: "short", side: "low" });
    const plan = planAlerts(
      [row({ scenario: lowShort, direction: "short" })],
      [open({ scenario: highLong, direction: "long" })]
    );
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].scenario.side).toBe("low");
    expect(plan.opens[0].direction).toBe("short");
    // 新开的警报要用这一轮的实时价重新锁价，不能延用旧警报的 triggerPrice。
    expect(plan.opens[0].triggerPrice).toBe(row().price);
  });

  // kind 相同、direction 也相同（两侧的 inventory_flush 都是 manage）时，
  // 光比 kind+direction 还是分不开侧——这正是评审意见里点名的第二类漏洞，
  // 所以判据必须再加上 side。
  it("同一个 kind、同一个 direction（都是 manage）但 side 不同：仍然当成不同场景", () => {
    const highManage = scenario({ kind: "inventory_flush", direction: "manage", side: "high" });
    const lowManage = scenario({ kind: "inventory_flush", direction: "manage", side: "low" });
    const plan = planAlerts(
      [row({ scenario: lowManage, direction: "long" })],
      [open({ scenario: highManage, direction: "long" })]
    );
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].scenario.side).toBe("low");
  });
});

describe("planAlerts · 场景消失（变成 null）要连续 3 轮才关", () => {
  it("场景消失一次只累计 belowCount，不关闭；scenario 诚实写成 null（评审 F3：不假装还有上一次的场景）", () => {
    const plan = planAlerts([row({ scenario: null })], [open({ belowCount: 0 })]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].belowCount).toBe(1);
    // 这一轮确实没有场景，AlertUpdate.scenario 就应该老实是 null——
    // listOpenAlerts 对迁移前的老警报本来就会返回 scenario:null，
    // 状态机不能假装"上一次已知场景"还成立，那是在骗类型系统。
    expect(plan.updates[0].scenario).toBeNull();
  });

  it("连续两轮场景缺席，belowCount 正确累计到 2，两轮都诚实写 null", () => {
    let state = [open({ belowCount: 0 })];
    for (let i = 0; i < 2; i++) {
      const plan = planAlerts([row({ scenario: null })], state);
      expect(plan.closes).toHaveLength(0);
      expect(plan.updates[0].scenario).toBeNull();
      state = [{ ...state[0], belowCount: plan.updates[0].belowCount, scenario: plan.updates[0].scenario }];
    }
    expect(state[0].belowCount).toBe(2);
  });

  it("连续达到 ALERT_CLOSE_STREAK 轮场景缺席才真的关闭", () => {
    const plan = planAlerts(
      [row({ scenario: null })],
      [open({ belowCount: ALERT_CLOSE_STREAK - 1 })]
    );
    expect(plan.closes).toEqual(["a1"]);
  });

  // 评审 F3 的直接后果：诚实传 null 之后，状态机不再有"上一次已知场景"可比较，
  // 场景消失哪怕只隔一轮又重新出现（即使 kind/direction/side 完全相同），
  // 也无法被判定为"同一场景"（isSame 要求两边都非空）——会被当成新事件立即
  // 关旧开新，而不是像旧实现那样静默延续 triggerPrice/peakPct。这是诚实
  // 换来的代价，不是遗漏：状态机确实"不知道"消失的这一轮之后它会不会回来，
  // 装作知道才是真正的 bug。
  it("场景消失一轮后又重新出现（即使完全同一个 kind/direction/side）：当成新事件立即关旧开新，不延续旧的 triggerPrice", () => {
    const afterOneMiss: OpenAlert = { ...open(), belowCount: 1, scenario: null };
    const plan = planAlerts([row({ scenario: scenario(), price: 105 })], [afterOneMiss]);
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].scenario.kind).toBe("healthy_trend");
    // 新警报用这一轮的实时价重新锁价（105），不是旧警报的 triggerPrice（100）。
    expect(plan.opens[0].triggerPrice).toBe(105);
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
