import { describe, it, expect } from "vitest";
import { pickExchangeRow } from "./market";

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
