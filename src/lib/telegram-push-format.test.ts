import { describe, it, expect } from "vitest";
import { formatScannerMessage } from "./telegram-push";
import type { TelegramPushSettings } from "./telegram-push";
import type { ScannerPayload, ScannerRow } from "./screener/types";
import type { Scenario } from "./screener/factors/scenario";

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
    dataGaps: [],
    scenario: null,
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

const payload: ScannerPayload = { rows: [row()], cards: [], newCards: [], computedAt: Date.UTC(2026, 7, 18, 12, 0) };

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

  it("推送不再自己过滤振幅——三条门槛全部在服务端执行，推送与界面看同一批币", () => {
    // 曾经这里有个 PUSH_MIN_AMPLITUDE（= 界面滑块最小值 1.5%）。选币改成
    // 「按振幅排名取前 N 个」之后，payload 里的行振幅实测都在 14% 以上，
    // 这道门槛筛不掉任何东西；而两边各写一个数字迟早会漂。
    const p: ScannerPayload = { ...payload, rows: [row({ amplitude: 1.2 })] };
    expect(formatScannerMessage(p, settings, "zh")).toContain("TIA");
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
    const msg = formatScannerMessage({ rows: [], cards: [], newCards: [], computedAt: 0 }, settings, "zh");
    expect(msg).toContain("暂无");
  });

  it("每组最多列 8 行——两组加起来仍要留在 Telegram 单条消息的长度上限内", () => {
    const many: ScannerPayload = {
      rows: Array.from({ length: 40 }, (_, i) => row({ symbol: `C${i}-USDT`, coin: `C${i}` })),
      cards: [],
      newCards: [],
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

  it("有场景判定的行带上场景名", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ scenario: scenario() })] };
    expect(formatScannerMessage(p, settings, "zh")).toContain("健康趋势");
  });

  it("陷阱场景加 ⚠ 前缀，非陷阱场景不加", () => {
    const trapRow = row({ scenario: scenario({ kind: "false_top_div", trap: true }) });
    const normalRow = row({ scenario: scenario() });
    expect(
      formatScannerMessage({ ...payload, rows: [trapRow] }, settings, "zh")
    ).toContain("⚠");
    expect(
      formatScannerMessage({ ...payload, rows: [normalRow] }, settings, "zh")
    ).not.toContain("⚠");
  });

  it("无场景判定的行不带场景名——不能因为加了这个字段就让老样式的行凭空多出文字", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ scenario: null })] };
    const msg = formatScannerMessage(p, settings, "zh");
    expect(msg).not.toContain("健康趋势");
    expect(msg).not.toContain("存量清算");
  });
});
