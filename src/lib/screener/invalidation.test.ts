import { describe, it, expect } from "vitest";
import { invalidationLine, isInvalidated, scenarioInvalidated, ignitionLine } from "./invalidation";
import type { Scenario } from "./factors/scenario";
import type { Ignition } from "./ignition";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

const B = 1_800_000;

function scenario(o: Partial<Scenario> = {}): Scenario {
  return {
    kind: "a2_accum_bottom_div",
    direction: "long",
    trap: false,
    strength: "strongest",
    triggeredAt: 5 * B,
    invalidation: { price: 100, breach: "below" },
    structureLevel: 100,
    cvdPct: 4,
    oiPct: 3,
    ...o,
  };
}

/** [time下标, high, low] → K 线 */
function bars(specs: Array<[number, number, number]>): CoinGlassPriceBar[] {
  return specs.map(([i, high, low]) => ({
    time: i * B,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(low),
    volume_usd: "1",
  }));
}

describe("invalidationLine", () => {
  it("直接用场景自己带的失效位", () => {
    // 新引擎里失效位是判定的一部分：规格要求每个场景都有明确失效位，
    // 没有就不成立。所以这里不再有一张「哪种场景赌什么」的推导表——
    // 那张表跟判定逻辑分居两个文件时迟早会对不上。
    expect(invalidationLine(scenario())).toEqual({ price: 100, breach: "below" });
  });

  it("做空侧的失效方向是往上穿", () => {
    const s = scenario({ direction: "short", invalidation: { price: 120, breach: "above" } });
    expect(invalidationLine(s)!.breach).toBe("above");
  });

  it("失效价非法时返回 null，而不是给一个错误的止损位", () => {
    expect(invalidationLine(scenario({ invalidation: { price: 0, breach: "below" } }))).toBeNull();
    expect(invalidationLine(scenario({ invalidation: { price: NaN, breach: "below" } }))).toBeNull();
  });
});

describe("isInvalidated", () => {
  it("用区间极值判，插针也算数", () => {
    // 止损被扫了就是被扫了。用收盘价判会漏掉真实发生过的穿越，
    // 而那种漏判恰恰发生在行情最剧烈、这张卡最需要被撤下的时候。
    expect(isInvalidated({ price: 100, breach: "below" }, 120, 99)).toBe(true);
  });

  it("恰好碰到不算穿——否则每张卡诞生的同一秒就失效", () => {
    // 失效价取自某一根 K 线的极值，「碰到」在锚点那一刻必然成立。
    expect(isInvalidated({ price: 100, breach: "below" }, 120, 100)).toBe(false);
    expect(isInvalidated({ price: 100, breach: "above" }, 100, 90)).toBe(false);
  });

  it("非法价格不误判成失效", () => {
    expect(isInvalidated({ price: 100, breach: "below" }, NaN, NaN)).toBe(false);
  });
});

describe("scenarioInvalidated", () => {
  it("窗口从触发那一刻算起，不是从我们第一次看到算起", () => {
    // 触发在下标 5。下标 3 那根跌破过 100，但它在触发之前，不该算数。
    const b = bars([
      [3, 110, 90],
      [5, 110, 105],
      [6, 110, 106],
    ]);
    expect(scenarioInvalidated(scenario(), b)).toBe(false);
  });

  it("触发之后跌破就是失效", () => {
    const b = bars([
      [5, 110, 105],
      [6, 110, 99],
    ]);
    expect(scenarioInvalidated(scenario(), b)).toBe(true);
  });

  it("触发点比整段序列还新时当作没失效", () => {
    // 理论上不可能（触发点就取自这段序列）。真出现了，宁可留着一个可疑的
    // 场景，也不要因为一个说不通的数据状态把所有场景静默清空。
    expect(scenarioInvalidated(scenario({ triggeredAt: 999 * B }), bars([[1, 110, 1]]))).toBe(false);
  });
});

describe("ignitionLine", () => {
  const ig = (o: Partial<Ignition> = {}): Ignition => ({
    direction: "up",
    level: 100,
    invalidationPrice: 98,
    distancePct: 1,
    ignitedAt: 0,
    barsAgo: 0,
    volumeRatio: 2,
    oiChangePct: 1,
    ...o,
  });

  it("用 invalidationPrice，不是被突破的那条区间边界", () => {
    // 边界本身太近：773 个真实事件里点火当下离边界的距离中位只有 0.38%，
    // 照那个位置判，84% 会被打穿，而且中位情况下在行情走出任何东西之前
    // 就已经作废。
    expect(ignitionLine(ig())).toEqual({ price: 98, breach: "below" });
  });

  it("向下点火的失效方向相反", () => {
    expect(ignitionLine(ig({ direction: "down", invalidationPrice: 102 }))!.breach).toBe("above");
  });

  it("失效价非法时返回 null", () => {
    expect(ignitionLine(ig({ invalidationPrice: 0 }))).toBeNull();
  });
});
