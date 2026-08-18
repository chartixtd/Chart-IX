import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatAlertMessage, parseAlertPushConfig, pushNewAlerts } from "./alert-push";
import { getTelegramPushSettings, listTargetsFor, deliverToTargets } from "@/lib/telegram-push";
import type { NewAlert } from "./alerts";

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
  // 固定返回「开启，minScore=80」，这样测试的重点——总开关检查——不会被
  // 这一层配置挡在前面。
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { value: { enabled: true, minScore: 80 } } }),
        }),
      }),
    }),
  }),
}));

const alert: NewAlert = {
  symbol: "TIA-USDT",
  direction: "long",
  triggerPrice: 0.2961,
  triggerScore: 87,
  factors: { zone: 29, sweep: 19, oi: 26, cvd: 13 },
};

describe("parseAlertPushConfig", () => {
  it("解析后台存的 JSON", () => {
    expect(parseAlertPushConfig({ enabled: true, minScore: 85 })).toEqual({ enabled: true, minScore: 85 });
  });

  it("没配置过时默认关闭——新功能不该自己开始往群里发消息", () => {
    expect(parseAlertPushConfig(null)).toEqual({ enabled: false, minScore: 80 });
  });

  it("minScore 低于触发线时抬回触发线，低了也不会有更多警报", () => {
    expect(parseAlertPushConfig({ enabled: true, minScore: 50 }).minScore).toBe(80);
  });

  it("字段类型不对时退回默认值而不是抛错", () => {
    expect(parseAlertPushConfig({ enabled: "yes", minScore: "high" })).toEqual({
      enabled: false,
      minScore: 80,
    });
  });
});

describe("formatAlertMessage", () => {
  it("带上锁定价——这是整条警报的基准，缺了它后续的累计涨跌无从谈起", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("0.2961");
  });

  it("带上触发分与四因子构成", () => {
    const msg = formatAlertMessage([alert], "en");
    expect(msg).toContain("87");
    expect(msg).toMatch(/Z29.*S19.*OI26.*CVD13/);
  });

  it("方向用文字标出", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("做多");
  });

  it("多条警报合并成一条消息，而不是刷屏", () => {
    const msg = formatAlertMessage([alert, { ...alert, symbol: "JTO-USDT" }], "en");
    expect(msg).toContain("TIA");
    expect(msg).toContain("JTO");
    expect(msg.split("\n").filter((l) => l.includes("Z29")).length).toBe(2);
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

  it("总开关打开且有可用 target 时正常推送", async () => {
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
