import { describe, it, expect } from "vitest";
import { buildScreenerAlertMessage, buildTestMessage } from "./messages";
import type { AlertCardData } from "@/lib/screener/cards";
import type { Scenario } from "@/lib/screener/factors/scenario";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    kind: "a1_healthy_pullback",
    direction: "long",
    trap: false,
    strength: "trend_best",
    triggeredAt: 0,
    invalidation: { price: 0.28, breach: "below" },
    structureLevel: 0.28,
    cvdPct: 3.1,
    oiPct: 2.4,
    ...overrides,
  };
}

function card(overrides: Partial<AlertCardData> = {}): AlertCardData {
  return {
    key: "TIA-USDT|healthy_trend|long|high|0.31",
    symbol: "TIA-USDT",
    coin: "TIA",
    trigger: { type: "scenario", scenario: scenario() },
    direction: "long",
    expired: false,
    factors: { oi: 26, cvd: 13 },
    total: 39,
    firstSeenAt: "2026-08-26T00:00:00.000Z",
    firstPrice: 2369.5,
    peakPct: 1.2,
    invalidation: null,
    ...overrides,
  };
}

describe("buildScreenerAlertMessage", () => {
  it("只有一张卡时说清楚是哪个币、什么事、怎么办", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [card()]);
    expect(msg.title).toBe("🚨 TIA 健康趋势回调");
    expect(msg.body).toBe("@2,369.5 · 顺势做多，回调进场");
  });

  it("点火卡走点火自己的说法，不套场景名", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [
      card({
        coin: "PENDLE",
        firstPrice: 1.8305,
        trigger: {
          type: "ignition",
          ignition: { direction: "up", level: 1.82, invalidationPrice: 1.8, distancePct: 0.6, ignitedAt: 0, barsAgo: 0, volumeRatio: 2, oiChangePct: 1.5 },
        },
      }),
    ]);
    expect(msg.title).toBe("🚨 PENDLE 向上点火");
    expect(msg.body).toBe("@1.8305 · 刚突破区间，顺势跟");
  });

  it("一美元以下的币必须留够小数位——0.09 对使用者毫无意义", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [card({ coin: "XX", firstPrice: 0.094261 })]);
    expect(msg.body).toContain("@0.094261");
  });

  it("多张卡合成一条：标题报数量，正文列币种", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [
      card({ coin: "PENDLE" }),
      card({ coin: "ICP" }),
      card({ coin: "SOL" }),
    ]);
    expect(msg.title).toBe("🚨 3 个新信号");
    expect(msg.body).toBe("PENDLE · ICP · SOL");
  });

  it("超过 5 个币种就折起来——通知栏一行装不下十几个", () => {
    const coins = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const msg = buildScreenerAlertMessage("zh-CN", coins.map((c) => card({ coin: c })));
    expect(msg.title).toBe("🚨 12 个新信号");
    expect(msg.body).toBe("A · B · C · D · E 等 12 个");
  });

  it("英文的折叠说的是「还有几个」而不是「一共几个」", () => {
    const coins = ["A", "B", "C", "D", "E", "F", "G"];
    const msg = buildScreenerAlertMessage("en-US", coins.map((c) => card({ coin: c })));
    expect(msg.title).toBe("🚨 7 new signals");
    expect(msg.body).toBe("A · B · C · D · E and 2 more");
  });

  it("ms-MY 的框架文案是马来语，场景名落到英文——已知的不对称", () => {
    const msg = buildScreenerAlertMessage("ms-MY", [card()]);
    expect(msg.title).toBe("🚨 TIA Healthy Pullback");
    const many = buildScreenerAlertMessage("ms-MY", [card({ coin: "A" }), card({ coin: "B" })]);
    expect(many.title).toBe("🚨 2 isyarat baharu");
  });

  it("空数组不崩——调用点已经挡掉了，但这里把行为钉住", () => {
    const msg = buildScreenerAlertMessage("zh-CN", []);
    expect(msg.title).toBe("🚨 0 个新信号");
    expect(msg.body).toBe("");
  });
});

/**
 * 文案表是个普通对象字面量，用 `in` 查键会走原型链：`"toString" in COPY`
 * 为真，于是 pick() 返回 Function.prototype.toString，下一行调 copy.alertTitle
 * 就是 TypeError，整轮推送连同 cron 一起炸。locale 现在在 subscribe 路由是
 * z.enum 白名单，但白名单之前写进 DB 的脏值不会有人回补，所以这道纵深防御
 * 要有测试钉住。
 */
describe("locale 的原型链键不能穿过文案表", () => {
  for (const key of ["toString", "valueOf", "constructor", "__proto__", "hasOwnProperty"]) {
    it(`buildScreenerAlertMessage("${key}") 落到 en-US 而不是抛`, () => {
      const msg = buildScreenerAlertMessage(key, [card({ coin: "A" }), card({ coin: "B" })]);
      expect(msg.title).toBe("🚨 2 new signals");
    });

    it(`buildTestMessage("${key}") 落到 en-US 而不是抛`, () => {
      expect(buildTestMessage(key).title).toBe("Chart-IX test notification");
    });
  }

  it("单卡路径也不能被原型链键带崩", () => {
    const msg = buildScreenerAlertMessage("toString", [card()]);
    expect(msg.title).toBe("🚨 TIA Healthy Pullback");
  });

  it("正常的三种 locale 不受影响", () => {
    expect(buildTestMessage("zh-CN").title).toBe("Chart-IX 测试通知");
    expect(buildTestMessage("ms-MY").title).toBe("Pemberitahuan ujian Chart-IX");
    expect(buildTestMessage("en-US").title).toBe("Chart-IX test notification");
  });
});
