import { describe, it, expect } from "vitest";
import { invalidationLine, isInvalidated } from "./invalidation";
import type { Scenario, ScenarioKind } from "./factors/scenario";

function sc(kind: ScenarioKind, side: "high" | "low"): Scenario {
  // 高点侧：新高 110 > 前高 100。低点侧镜像：新低 90 < 前低 100。
  return {
    kind,
    direction: "long",
    trap: false,
    swingPrev: 100,
    swingNow: side === "high" ? 110 : 90,
    cvdPct: 0,
    oiPct: 0,
    side,
  };
}

describe("invalidationLine", () => {
  it("真背离赌极值本身：失效线在 swingNow，往极值方向穿", () => {
    // 真顶背离说「110 这个高点是虚的」——涨过 110 就说明它不虚。
    expect(invalidationLine(sc("true_top_div", "high"))).toEqual({ price: 110, breach: "above" });
    // 真底背离说「90 这个低点是虚的」——跌破 90 就说明它不虚。
    expect(invalidationLine(sc("true_bottom_div", "low"))).toEqual({ price: 90, breach: "below" });
  });

  it("其余四种赌突破成立：失效线在 swingPrev，往收回的方向穿", () => {
    for (const kind of ["healthy_trend", "inventory_flush", "false_top_div"] as ScenarioKind[]) {
      expect(invalidationLine(sc(kind, "high"))).toEqual({ price: 100, breach: "below" });
    }
    for (const kind of ["healthy_trend", "inventory_flush", "false_bottom_div"] as ScenarioKind[]) {
      expect(invalidationLine(sc(kind, "low"))).toEqual({ price: 100, breach: "above" });
    }
  });

  it("失效线永远落在「当前价格已经走过的那一侧」的反方向", () => {
    // 这条钉的是最容易搞反的地方：高点侧的失效线要么在更高处（真背离），
    // 要么在下方（其余四种）——绝不会出现「高点侧却要求跌破 swingNow」
    // 这种既不是止损也不是目标的位置。
    for (const kind of [
      "healthy_trend", "inventory_flush", "true_top_div", "false_top_div",
    ] as ScenarioKind[]) {
      const line = invalidationLine(sc(kind, "high"))!;
      if (line.breach === "above") expect(line.price).toBe(110); // 只可能是极值
      else expect(line.price).toBe(100); // 只可能是前一个摆动点
    }
  });

  it("锚点价格非法时返回 null，而不是给一个错误的止损位", () => {
    expect(invalidationLine({ ...sc("healthy_trend", "high"), swingPrev: 0 })).toBeNull();
    expect(invalidationLine({ ...sc("true_top_div", "high"), swingNow: NaN })).toBeNull();
  });
});

describe("isInvalidated", () => {
  const above = { price: 110, breach: "above" as const };
  const below = { price: 100, breach: "below" as const };

  it("穿过去才算失效", () => {
    expect(isInvalidated(above, 110.1, 90)).toBe(true);
    expect(isInvalidated(above, 109.9, 90)).toBe(false);
    expect(isInvalidated(below, 120, 99.9)).toBe(true);
    expect(isInvalidated(below, 120, 100.1)).toBe(false);
  });

  it("恰好碰到不算——否则每张卡诞生的同一秒就会判定失效", () => {
    // 摆动点价格本身就是那根 K 线的最高/最低价，所以「碰到」在锚点
    // 那一刻必然成立。用 >= 的话真背离的卡永远活不过一秒。
    expect(isInvalidated(above, 110, 90)).toBe(false);
    expect(isInvalidated(below, 120, 100)).toBe(false);
  });

  it("看区间最高/最低价，插针也算数", () => {
    // 收盘价回到线内，但盘中插针穿过去了——止损被扫了就是被扫了。
    expect(isInvalidated(above, 115, 105)).toBe(true);
    expect(isInvalidated(below, 120, 95)).toBe(true);
  });

  it("实时逐笔价：同一个价格同时当 high 和 low 传，行为一致", () => {
    expect(isInvalidated(above, 111, 111)).toBe(true);
    expect(isInvalidated(above, 109, 109)).toBe(false);
  });

  it("非有限值不算失效——宁可留着卡，也不要因为一个坏数据误撤", () => {
    expect(isInvalidated(above, NaN, 90)).toBe(false);
    expect(isInvalidated(below, 120, NaN)).toBe(false);
  });
});
