import { describe, it, expect } from "vitest";
import {
  floorToPrecision,
  quoteToBase,
  validateOrderSize,
  requiredMargin,
  formatQty,
  roundPrice,
} from "./sizing";
import type { SymbolSpec } from "@/types/trading";

const btcSpot: SymbolSpec = {
  symbol: "BTC-USDT",
  market: "spot",
  pricePrecision: 1,
  quantityPrecision: 6,
  minQty: 0.0001,
  minNotional: 5,
  tradable: true,
};

const btcFutures: SymbolSpec = {
  symbol: "BTC-USDT",
  market: "futures",
  pricePrecision: 1,
  quantityPrecision: 4,
  minQty: 0.0001,
  minNotional: 2,
  maxLeverage: 125,
  takerFeeRate: 0.0005,
  tradable: true,
};

describe("floorToPrecision", () => {
  it("truncates rather than rounds", () => {
    expect(floorToPrecision(0.123456789, 4)).toBe(0.1234);
    expect(floorToPrecision(0.99999, 2)).toBe(0.99);
  });

  it("handles zero precision", () => {
    expect(floorToPrecision(7.9, 0)).toBe(7);
  });

  it("does not produce floating point noise", () => {
    expect(floorToPrecision(0.07 * 3, 2)).toBe(0.21);
    expect(floorToPrecision(0.29, 2)).toBe(0.29);
  });

  it("returns 0 for non-finite input", () => {
    expect(floorToPrecision(NaN, 2)).toBe(0);
    expect(floorToPrecision(Infinity, 2)).toBe(0);
  });

  it("floors edge case with rounding carry at precision boundary", () => {
    expect(floorToPrecision(4.99995, 0)).toBe(4);
  });

  it("handles carry-through rounding at target precision", () => {
    expect(floorToPrecision(0.12349999951, 4)).toBe(0.1234);
  });

  it("clamps precision to 100 without throwing", () => {
    expect(() => floorToPrecision(5.01, 101)).not.toThrow();
    expect(floorToPrecision(5.01, 101)).toBe(5.01);
  });
});

describe("quoteToBase", () => {
  it("converts a USDT notional into a coin quantity", () => {
    const s = quoteToBase(1000, 50000, btcFutures);
    expect(s.qty).toBe(0.02);
    expect(s.price).toBe(50000);
  });

  it("floors the quantity so the notional never exceeds the budget", () => {
    const s = quoteToBase(100, 33333, btcFutures);
    expect(s.qty).toBe(0.003);
    expect(s.notional).toBeLessThanOrEqual(100);
  });

  it("recomputes notional from the floored quantity", () => {
    const s = quoteToBase(100, 33333, btcFutures);
    expect(s.notional).toBeCloseTo(0.003 * 33333, 8);
  });

  it("returns zero quantity when the budget is below one precision step", () => {
    const s = quoteToBase(1, 50000, btcFutures);
    expect(s.qty).toBe(0);
  });

  it("returns zero for a non-positive price", () => {
    expect(quoteToBase(100, 0, btcFutures).qty).toBe(0);
    expect(quoteToBase(100, -1, btcFutures).qty).toBe(0);
  });

  it("returns zero for a non-positive notional", () => {
    expect(quoteToBase(0, 50000, btcFutures).qty).toBe(0);
    expect(quoteToBase(-10, 50000, btcFutures).qty).toBe(0);
  });

  it("uses the spot precision for spot symbols", () => {
    const s = quoteToBase(100, 33333, btcSpot);
    expect(s.qty).toBe(0.003);
  });

  it("never exceeds the budget with edge-case rounding", () => {
    const s = quoteToBase(100.0349996031, 810, btcFutures);
    expect(s.notional).toBeLessThanOrEqual(100.0349996031);
  });
});

describe("validateOrderSize", () => {
  it("accepts an order above both minimums", () => {
    expect(validateOrderSize(quoteToBase(1000, 50000, btcFutures), btcFutures)).toEqual({ ok: true });
  });

  it("rejects a quantity that rounds to zero", () => {
    const r = validateOrderSize(quoteToBase(1, 50000, btcFutures), btcFutures);
    expect(r).toEqual({ ok: false, reason: "ZERO_AFTER_ROUNDING" });
  });

  it("rejects a notional below the symbol minimum", () => {
    const r = validateOrderSize({ qty: 0.00006, notional: 3, price: 50000 }, btcSpot);
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_NOTIONAL", limit: 5 });
  });

  it("rejects a quantity below the symbol minimum", () => {
    const r = validateOrderSize({ qty: 0.00005, notional: 10, price: 200000 }, btcFutures);
    expect(r).toEqual({ ok: false, reason: "BELOW_MIN_QTY", limit: 0.0001 });
  });

  it("rejects a symbol that is not tradable", () => {
    const spec = { ...btcFutures, tradable: false };
    const r = validateOrderSize(quoteToBase(1000, 50000, spec), spec);
    expect(r).toEqual({ ok: false, reason: "NOT_TRADABLE" });
  });

  it("checks tradability before anything else", () => {
    const spec = { ...btcFutures, tradable: false };
    const r = validateOrderSize({ qty: 0, notional: 0, price: 0 }, spec);
    expect(r).toEqual({ ok: false, reason: "NOT_TRADABLE" });
  });

  it("rejects non-finite qty with INVALID_INPUT reason", () => {
    const r = validateOrderSize({ qty: NaN, notional: 10, price: 1 }, btcFutures);
    expect(r).toEqual({ ok: false, reason: "INVALID_INPUT" });
  });
});

describe("requiredMargin", () => {
  it("divides notional by leverage", () => {
    expect(requiredMargin(1000, 10)).toBe(100);
  });

  it("treats leverage below 1 as 1", () => {
    expect(requiredMargin(1000, 0)).toBe(1000);
    expect(requiredMargin(1000, -5)).toBe(1000);
  });
});

describe("formatQty and roundPrice", () => {
  it("emits a fixed-precision string without exponent notation", () => {
    expect(formatQty(0.00002, { ...btcFutures, quantityPrecision: 8 })).toBe("0.00002000");
    expect(formatQty(1, btcFutures)).toBe("1.0000");
  });

  it("rounds price to the symbol price precision", () => {
    expect(roundPrice(50000.16, btcFutures)).toBe("50000.2");
    expect(roundPrice(50000.14, btcFutures)).toBe("50000.1");
  });
});
