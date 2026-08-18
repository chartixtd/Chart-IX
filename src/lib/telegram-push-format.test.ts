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
    factors: { zone: 28, sweep: 18, oi: 25, cvd: 14 },
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
  it("是一张按总分排序的单表，不再分做多/做空两组", () => {
    const msg = formatScannerMessage(payload, settings, "zh");
    expect(msg).not.toContain("做多优势");
    expect(msg).not.toContain("做空优势");
    expect(msg).toContain("TIA");
  });

  it("带上方向标记", () => {
    expect(formatScannerMessage(payload, settings, "zh")).toContain("做多");
  });

  it("因子构成按 Zone/Sweep/OI/CVD 顺序展开", () => {
    const msg = formatScannerMessage(payload, settings, "en");
    expect(msg).toMatch(/Z28.*S18.*OI25.*CVD14/);
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

  it("最多只列前 15 行——Telegram 单条消息有长度上限", () => {
    const many: ScannerPayload = {
      rows: Array.from({ length: 40 }, (_, i) => row({ symbol: `C${i}-USDT`, coin: `C${i}` })),
      computedAt: 0,
    };
    const msg = formatScannerMessage(many, settings, "en");
    expect(msg).toContain("C14");
    expect(msg).not.toContain("C15");
  });

  it("转义 HTML，防止币名里的尖括号破坏 parse_mode", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ symbol: "<b>-USDT", coin: "<b>" })] };
    expect(formatScannerMessage(p, settings, "en")).toContain("&lt;b&gt;");
  });
});
