import { describe, it, expect } from "vitest";
import { pickFundingRate } from "./funding";
import type { CoinGlassFundingRow } from "@/lib/coinglass/types";

const row: CoinGlassFundingRow = {
  symbol: "TIA",
  stablecoin_margin_list: [
    { exchange: "Binance", funding_rate: 0.01 },
    { exchange: "BingX", funding_rate: 0.005 },
    { exchange: "Bybit", funding_rate: 0.03 },
  ],
};

describe("pickFundingRate", () => {
  it("优先取用户实际下单那家的费率，而不是市场平均值", () => {
    expect(pickFundingRate(row, "BingX")).toBe(0.005);
  });

  it("指定交易所没有时回落到中位数", () => {
    expect(pickFundingRate(row, "Kraken")).toBe(0.01);
  });

  it("偶数个交易所时中位数取中间两个的平均", () => {
    const two: CoinGlassFundingRow = {
      symbol: "X",
      stablecoin_margin_list: [
        { exchange: "A", funding_rate: 0.02 },
        { exchange: "B", funding_rate: 0.04 },
      ],
    };
    expect(pickFundingRate(two, "Kraken")).toBeCloseTo(0.03);
  });

  it("整行缺失返回 null 而不是 0——0 是一个真实的费率值，不能拿它当缺失", () => {
    expect(pickFundingRate(undefined, "BingX")).toBeNull();
  });

  it("列表为空返回 null", () => {
    expect(pickFundingRate({ symbol: "X", stablecoin_margin_list: [] }, "BingX")).toBeNull();
  });

  it("忽略非有限值", () => {
    const dirty: CoinGlassFundingRow = {
      symbol: "X",
      stablecoin_margin_list: [
        { exchange: "A", funding_rate: Number.NaN },
        { exchange: "B", funding_rate: 0.02 },
      ],
    };
    expect(pickFundingRate(dirty, "Kraken")).toBe(0.02);
  });
});
