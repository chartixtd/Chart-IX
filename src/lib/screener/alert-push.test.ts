import { describe, it, expect } from "vitest";
import { formatAlertMessage, parseAlertPushConfig } from "./alert-push";
import type { NewAlert } from "./alerts";

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
