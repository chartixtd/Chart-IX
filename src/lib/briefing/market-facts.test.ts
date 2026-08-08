import { describe, it, expect } from "vitest";
import { BRIEFING_SYMBOLS, buildMarketFacts } from "./market-facts";

// 形态照抄 2026-08-08 现货接口实测响应：
// priceChangePercent 是带百分号的字符串，价格字段是数字而非类型声明的 string
const REAL_SHAPE = [
  { symbol: "BTC-USDT", lastPrice: 64959.52, openPrice: 64369.69, priceChangePercent: "0.92%" },
  { symbol: "ETH-USDT", lastPrice: 1914.99, openPrice: 1903.71, priceChangePercent: "0.59%" },
  { symbol: "XAUT-USDT", lastPrice: 4325.51, openPrice: 4267.19, priceChangePercent: "1.37%" },
  { symbol: "NOTWANTED-USDT", lastPrice: 1, openPrice: 1, priceChangePercent: "0.00%" },
];

describe("BRIEFING_SYMBOLS", () => {
  it("黄金用 XAUT/PAXG，不用合约独有的 NCCOGOLD", () => {
    const symbols = BRIEFING_SYMBOLS.map((s) => s.symbol);
    expect(symbols).toContain("XAUT-USDT");
    expect(symbols).toContain("PAXG-USDT");
    expect(symbols).not.toContain("NCCOGOLD2USD-USDT");
  });

  it("含全部核心加密标的", () => {
    const symbols = BRIEFING_SYMBOLS.map((s) => s.symbol);
    for (const s of ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT", "DOGE-USDT"]) {
      expect(symbols).toContain(s);
    }
  });
});

describe("buildMarketFacts", () => {
  it("只取清单内的标的", () => {
    const facts = buildMarketFacts(REAL_SHAPE);
    expect(facts.map((f) => f.symbol)).not.toContain("NOTWANTED-USDT");
    expect(facts).toHaveLength(3);
  });

  it("剥掉百分号并转成数字", () => {
    const btc = buildMarketFacts(REAL_SHAPE).find((f) => f.symbol === "BTC-USDT")!;
    expect(btc.change24hPct).toBe(0.92);
    expect(btc.lastPrice).toBe(64959.52);
  });

  it("负涨跌正确解析", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: 100, openPrice: 110, priceChangePercent: "-9.09%" },
    ]);
    expect(facts[0].change24hPct).toBe(-9.09);
  });

  it("字符串形态的价格也接受（类型声明是 string）", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: "64959.52", openPrice: "64369.69", priceChangePercent: "0.92%" },
    ]);
    expect(facts[0].lastPrice).toBe(64959.52);
  });

  it("openPrice 为 0 的坏数据被剔除（会产生天文数字涨跌幅）", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: 100, openPrice: 0, priceChangePercent: "822096901.00%" },
    ]);
    expect(facts).toHaveLength(0);
  });

  it("涨跌幅无法解析时剔除", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: 100, openPrice: 90, priceChangePercent: "n/a" },
    ]);
    expect(facts).toHaveLength(0);
  });

  it("空输入返回空数组，不抛错", () => {
    expect(buildMarketFacts([])).toEqual([]);
  });

  it("label 是去掉 -USDT 的简称", () => {
    const btc = buildMarketFacts(REAL_SHAPE).find((f) => f.symbol === "BTC-USDT")!;
    expect(btc.label).toBe("BTC");
  });
});
