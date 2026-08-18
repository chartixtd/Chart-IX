import { describe, it, expect } from "vitest";
import { pickExchangeRow } from "./market";
import { pickAggregatedOi } from "./open-interest";
import type { CoinGlassOpenInterestRow } from "./types";

const rows = [
  { exchange_name: "Binance", volume_usd: 900, current_price: 1 },
  { exchange_name: "BingX", volume_usd: 100, current_price: 1.01 },
  { exchange_name: "Bybit", volume_usd: 500, current_price: 0.99 },
];

describe("pickExchangeRow", () => {
  it("优先返回指定交易所", () => {
    expect(pickExchangeRow(rows, "BingX")?.exchange_name).toBe("BingX");
  });

  it("指定交易所不存在时回落到成交额最大的一家", () => {
    expect(pickExchangeRow(rows, "Kraken")?.exchange_name).toBe("Binance");
  });

  it("空数组返回 undefined 而不是抛错", () => {
    expect(pickExchangeRow([], "Binance")).toBeUndefined();
  });
});

describe("pickAggregatedOi", () => {
  const oiRows = [
    { exchange: "Binance", open_interest_usd: 10 },
    { exchange: "All", open_interest_usd: 30 },
  ] as CoinGlassOpenInterestRow[];

  it("只认 All 这一行——单交易所 OI 噪音大，聚合才是真实杠杆水位", () => {
    expect(pickAggregatedOi(oiRows)?.open_interest_usd).toBe(30);
  });

  it("没有 All 行时返回 undefined，绝不退而求其次拿单交易所顶替", () => {
    expect(pickAggregatedOi([oiRows[0]])).toBeUndefined();
  });
});
