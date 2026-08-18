import { describe, it, expect } from "vitest";
import { formatScannerMessage } from "./telegram-push";
import type { TelegramPushSettings } from "./telegram-push";
import type { ScannerPayload, ScannerRow } from "./screener/types";

const settings: TelegramPushSettings = {
  enabled: true,
  botToken: null,
  chatId: null,
  messageLang: "zh",
  pushIntervalMinutes: 60,
  showPrice: true,
  showChange24h: true,
  showAmplitude: true,
  showMarketCap: true,
  showVolume: true,
  showDirection: true,
  showFunding: true,
  showScore: true,
  showFactors: true,
  lastPushedAt: null,
  lastAttemptAt: null,
  lastError: null,
  consecutiveFailures: 0,
  updatedAt: "",
};

function row(o: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { oi: 25, cvd: 14 },
    price: 0.296,
    change24h: -1.92,
    amplitude: 4.3,
    volumeUsd: 21_400_000,
    marketCap: 311_000_000,
    marketCapRank: 120,
    fundingRate: 0.005,
    sourceExchange: "Binance",
    ...o,
  };
}

const payload: ScannerPayload = { rows: [row()], computedAt: Date.UTC(2026, 7, 18, 12, 0) };

describe("formatScannerMessage", () => {
  it("做多与做空分成两组，各带自己的标题", () => {
    const p: ScannerPayload = {
      ...payload,
      rows: [
        row({ symbol: "L-USDT", coin: "LONGCOIN", direction: "long" }),
        row({ symbol: "S-USDT", coin: "SHORTCOIN", direction: "short" }),
      ],
    };
    const msg = formatScannerMessage(p, settings, "zh");
    expect(msg).toContain("🟢");
    expect(msg).toContain("🔴");
    // 做多那一组必须整体排在做空之前，且各自的币落在自己那一组里
    expect(msg.indexOf("LONGCOIN")).toBeLessThan(msg.indexOf("🔴"));
    expect(msg.indexOf("SHORTCOIN")).toBeGreaterThan(msg.indexOf("🔴"));
  });

  it("某个方向一个币都没有时，那一组显示空提示而不是整条消息消失", () => {
    const msg = formatScannerMessage(payload, settings, "zh");
    expect(msg).toContain("TIA");
    expect(msg).toContain("🔴");
  });

  it("振幅低于推送门槛的币不进消息", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ amplitude: 1.2 })] };
    expect(formatScannerMessage(p, settings, "zh")).not.toContain("TIA");
  });

  it("带上方向标记", () => {
    expect(formatScannerMessage(payload, settings, "zh")).toContain("做多");
  });

  it("因子构成按 OI/CVD 顺序展开", () => {
    const msg = formatScannerMessage(payload, settings, "en");
    expect(msg).toMatch(/OI25.*CVD14/);
  });

  it("关掉因子开关就不输出因子构成", () => {
    const msg = formatScannerMessage(payload, { ...settings, showFactors: false }, "en");
    expect(msg).not.toContain("CVD14");
  });

  it("资金费率为 null 时整段省略，而不是显示 0.0000%", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ fundingRate: null })] };
    expect(formatScannerMessage(p, settings, "en")).not.toContain("Funding");
  });

  it("空榜单给一句明确的话，不给一张空表", () => {
    const msg = formatScannerMessage({ rows: [], computedAt: 0 }, settings, "zh");
    expect(msg).toContain("暂无");
  });

  it("每组最多列 8 行——两组加起来仍要留在 Telegram 单条消息的长度上限内", () => {
    const many: ScannerPayload = {
      rows: Array.from({ length: 40 }, (_, i) => row({ symbol: `C${i}-USDT`, coin: `C${i}` })),
      computedAt: 0,
    };
    const msg = formatScannerMessage(many, settings, "en");
    expect(msg).toContain("C7");
    expect(msg).not.toContain("C8");
  });

  it("转义 HTML，防止币名里的尖括号破坏 parse_mode", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ symbol: "<b>-USDT", coin: "<b>" })] };
    expect(formatScannerMessage(p, settings, "en")).toContain("&lt;b&gt;");
  });
});
