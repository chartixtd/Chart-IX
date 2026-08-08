import { describe, it, expect } from "vitest";
import {
  classifyInstrument,
  isNonCryptoInstrument,
  formatInstrumentLabel,
  isContractOpen,
  hasUsableQuote,
} from "./instruments";

describe("classifyInstrument", () => {
  it("classifies each NC-prefixed instrument type", () => {
    expect(classifyInstrument("NCCOGOLD2USD-USDT")).toBe("commodities");
    expect(classifyInstrument("NCFXEUR2USD-USDT")).toBe("forex");
    expect(classifyInstrument("NCSKTSLA2USD-USDT")).toBe("stocks");
    expect(classifyInstrument("NCSINASDAQ1002USD-USDT")).toBe("indices");
  });

  it("classifies everything else as crypto, including real NC-prefixed coins", () => {
    expect(classifyInstrument("BTC-USDT")).toBe("crypto");
    expect(classifyInstrument("NCASH-USDT")).toBe("crypto");
  });
});

describe("isNonCryptoInstrument", () => {
  it("is true only for the four synthetic prefixes", () => {
    expect(isNonCryptoInstrument("NCCOGOLD2USD-USDT")).toBe(true);
    expect(isNonCryptoInstrument("BTC-USDT")).toBe(false);
  });
});

describe("formatInstrumentLabel", () => {
  it("returns the raw symbol when no displayName is available (real crypto)", () => {
    expect(formatInstrumentLabel("BTC-USDT")).toBe("BTC-USDT");
  });

  it("ignores displayName for real crypto even when BingX provides one", () => {
    // BingX 给每个合约都带 displayName，加密永续的值也就是符号本身
    // （如 "BTC-USDT"）——不按分类过滤会把 "BTC-USDT" 悄悄剥成 "BTC"。
    expect(formatInstrumentLabel("BTC-USDT", "BTC-USDT")).toBe("BTC-USDT");
  });

  it("strips the -USDT suffix from displayName for non-forex instruments", () => {
    expect(formatInstrumentLabel("NCCOGOLD2USD-USDT", "GOLD(XAU)-USDT")).toBe("GOLD(XAU)");
    expect(formatInstrumentLabel("NCSKTSLA2USD-USDT", "TSLA-USDT")).toBe("TSLA");
    expect(formatInstrumentLabel("NCSINASDAQ1002USD-USDT", "NASDAQ100-USDT")).toBe("NASDAQ100");
  });

  it("inserts a slash for 6-letter forex codes", () => {
    expect(formatInstrumentLabel("NCFXEUR2USD-USDT", "EURUSD-USDT")).toBe("EUR/USD");
  });

  it("leaves non-forex, non-6-letter displayNames alone (no slash inserted)", () => {
    expect(formatInstrumentLabel("NCSIDXY2USD-USDT", "US Dollar Index (DXY)-USDT")).toBe("US Dollar Index (DXY)");
  });
});

describe("isContractOpen", () => {
  it("treats status 1 as open and 25 (paused) as closed", () => {
    expect(isContractOpen(1)).toBe(true);
    expect(isContractOpen(25)).toBe(false);
  });
});

describe("hasUsableQuote", () => {
  it("accepts a normal quote", () => {
    expect(hasUsableQuote({ lastPrice: "4345.21", openPrice: "4342.68" })).toBe(true);
  });

  it("accepts a numeric lastPrice (spot returns number, futures returns string)", () => {
    expect(hasUsableQuote({ lastPrice: 64975.3, openPrice: "64000.1" })).toBe(true);
  });

  // BingX 对从未成交过的代币化标的返回 openPrice=0，priceChangePercent 随之
  // 变成 +822096901.00% 这种天文数字，不能直接渲染。
  it("rejects the openPrice=0 quotes that produce absurd percentages", () => {
    expect(hasUsableQuote({ lastPrice: "82.20969", openPrice: "0.00000" })).toBe(false);
    expect(hasUsableQuote({ lastPrice: "0.00000", openPrice: "0.00000" })).toBe(false);
  });

  it("rejects a missing ticker", () => {
    expect(hasUsableQuote(undefined)).toBe(false);
  });
});
