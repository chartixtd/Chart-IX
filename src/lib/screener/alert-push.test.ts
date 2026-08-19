import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatAlertMessage, parseAlertPushConfig, pushNewAlerts } from "./alert-push";
import { getTelegramPushSettings, listTargetsFor, deliverToTargets } from "@/lib/telegram-push";
import type { NewAlert } from "./alerts";
import type { Scenario } from "./factors/scenario";

// pushNewAlerts 的编排逻辑要靠 mock 掉外部依赖来测——真实实现会打 Supabase
// 和 Telegram API。这里只 mock 三层：telegram-push（总开关/targets/投递）、
// alerts-store（落库标记）、supabase/middleware（getAlertPushConfig 读配置用）。
vi.mock("@/lib/telegram-push", () => ({
  getTelegramPushSettings: vi.fn(),
  listTargetsFor: vi.fn(),
  deliverToTargets: vi.fn(),
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));
vi.mock("./alerts-store", () => ({ markAlertsPushed: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({
  // getAlertPushConfig 走这条链路读 admin_settings.screener_alert_push；
  // 固定返回「开启」，这样测试的重点——总开关检查——不会被这一层配置挡在前面。
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { value: { enabled: true } } }),
        }),
      }),
    }),
  }),
}));

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    kind: "healthy_trend",
    direction: "long",
    trap: false,
    swingPrev: 0.28,
    swingNow: 0.2961,
    cvdPct: 3.1,
    oiPct: 2.4,
    side: "high",
    ...overrides,
  };
}

const alert: NewAlert = {
  symbol: "TIA-USDT",
  direction: "long",
  triggerPrice: 0.2961,
  triggerScore: 87,
  factors: { oi: 26, cvd: 13 },
  scenario: scenario(),
};

describe("parseAlertPushConfig", () => {
  it("解析后台存的 JSON", () => {
    expect(parseAlertPushConfig({ enabled: true })).toEqual({ enabled: true });
  });

  it("没配置过时默认关闭——新功能不该自己开始往群里发消息", () => {
    expect(parseAlertPushConfig(null)).toEqual({ enabled: false });
  });

  it("字段类型不对时退回默认值而不是抛错", () => {
    expect(parseAlertPushConfig({ enabled: "yes" })).toEqual({ enabled: false });
  });

  it("旧配置里残留的 minScore 字段被直接忽略，不报错也不参与判断", () => {
    // T22 删除了 minScore 这个概念（触发条件已经不是总分），后台存量配置
    // 里可能还留着这个字段，不能因为多了一个陌生字段就解析失败。
    expect(parseAlertPushConfig({ enabled: true, minScore: 80 })).toEqual({ enabled: true });
  });
});

describe("formatAlertMessage", () => {
  it("带上锁定价——这是整条警报的基准，缺了它后续的累计涨跌无从谈起", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("0.2961");
  });

  it("带上两因子构成", () => {
    const msg = formatAlertMessage([alert], "en");
    expect(msg).toMatch(/OI26.*CVD13/);
  });

  it("方向用文字标出", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("做多");
  });

  it("带上场景名与操作文案", () => {
    const msg = formatAlertMessage([alert], "zh");
    expect(msg).toContain("健康趋势");
    expect(msg).toContain("顺势，回调进场");
  });

  it("陷阱场景加 ⚠ 前缀，非陷阱场景不加", () => {
    const trapAlert: NewAlert = { ...alert, scenario: scenario({ kind: "false_top_div", trap: true, direction: "long" }) };
    expect(formatAlertMessage([trapAlert], "zh")).toContain("⚠");
    expect(formatAlertMessage([alert], "zh")).not.toContain("⚠");
  });

  it("manage 场景显示为「观望」而不是做多/做空", () => {
    const manageAlert: NewAlert = {
      ...alert,
      scenario: scenario({ kind: "inventory_flush", direction: "manage" }),
    };
    expect(formatAlertMessage([manageAlert], "zh")).toContain("观望");
  });

  it("多条警报合并成一条消息，而不是刷屏", () => {
    const msg = formatAlertMessage([alert, { ...alert, symbol: "JTO-USDT" }], "en");
    expect(msg).toContain("TIA");
    expect(msg).toContain("JTO");
    expect(msg.split("\n").filter((l) => l.includes("OI26")).length).toBe(2);
  });

  it("转义 HTML", () => {
    expect(formatAlertMessage([{ ...alert, symbol: "<i>-USDT" }], "en")).toContain("&lt;i&gt;");
  });
});

describe("pushNewAlerts", () => {
  beforeEach(() => {
    vi.mocked(getTelegramPushSettings).mockReset();
    vi.mocked(listTargetsFor).mockReset();
    vi.mocked(deliverToTargets).mockReset();
  });

  it("Telegram 推送总开关关闭时一条都不发——运营关的是「机器人静音」，警报不该绕过", async () => {
    vi.mocked(getTelegramPushSettings).mockResolvedValue({ enabled: false, botToken: "tok" } as never);

    const result = await pushNewAlerts([alert]);

    expect(result).toBe(0);
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  it("总开关打开且有可用 target 时正常推送，不再按分数过滤", async () => {
    vi.mocked(getTelegramPushSettings).mockResolvedValue({ enabled: true, botToken: "tok" } as never);
    vi.mocked(listTargetsFor).mockResolvedValue([
      { id: "t1", enabled: true, botToken: null } as never,
    ]);
    vi.mocked(deliverToTargets).mockResolvedValue([{ ok: true } as never]);

    const result = await pushNewAlerts([alert]);

    expect(deliverToTargets).toHaveBeenCalledTimes(1);
    expect(result).toBe(1);
  });
});
