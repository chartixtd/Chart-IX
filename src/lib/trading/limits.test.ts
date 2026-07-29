import { describe, it, expect } from "vitest";
import { mergeLimits, checkLimits } from "./limits";
import type { TradingLimits, LimitCheckInput } from "@/types/trading";

const unlimited: TradingLimits = {
  maxNotionalPerOrder: null,
  maxOrdersPerDay: null,
  maxLeverage: null,
  allowedSymbols: null,
};

const baseInput: LimitCheckInput = {
  symbol: "BTC-USDT",
  notional: 100,
  leverage: 10,
  ordersToday: 0,
};

describe("mergeLimits", () => {
  it("returns an unlimited config when both sides are null", () => {
    expect(mergeLimits(null, null)).toEqual(unlimited);
  });

  it("uses the global config when the user has none", () => {
    const global = { ...unlimited, maxNotionalPerOrder: 500 };
    expect(mergeLimits(global, null).maxNotionalPerOrder).toBe(500);
  });

  it("lets a user value override the global value field by field", () => {
    const global = { ...unlimited, maxNotionalPerOrder: 500, maxLeverage: 20 };
    const user = { ...unlimited, maxNotionalPerOrder: 1000 };
    const merged = mergeLimits(global, user);
    expect(merged.maxNotionalPerOrder).toBe(1000);
    expect(merged.maxLeverage).toBe(20);
  });

  it("treats a user null as not-overridden rather than unlimited", () => {
    const global = { ...unlimited, maxLeverage: 20 };
    const user = { ...unlimited, maxNotionalPerOrder: 1000 };
    expect(mergeLimits(global, user).maxLeverage).toBe(20);
  });

  it("falls back to the user config alone when the global row is missing", () => {
    const user = { ...unlimited, maxNotionalPerOrder: 1000, maxLeverage: 20 };
    expect(mergeLimits(null, user)).toEqual(user);
  });

  it("treats a user override of 0 as a real override, not an absent value", () => {
    const global = { ...unlimited, maxOrdersPerDay: 50 };
    const user = { ...unlimited, maxOrdersPerDay: 0 };
    expect(mergeLimits(global, user).maxOrdersPerDay).toBe(0);
  });

  it("treats a user override of an empty allowlist as a real override, not an absent value", () => {
    const global = { ...unlimited, allowedSymbols: ["BTC-USDT", "ETH-USDT"] };
    const user = { ...unlimited, allowedSymbols: [] };
    expect(mergeLimits(global, user).allowedSymbols).toEqual([]);
  });
});

describe("checkLimits", () => {
  it("passes when nothing is configured", () => {
    expect(checkLimits(baseInput, unlimited)).toEqual({ ok: true });
  });

  it("rejects a notional above the cap", () => {
    const r = checkLimits({ ...baseInput, notional: 600 }, { ...unlimited, maxNotionalPerOrder: 500 });
    expect(r).toEqual({ ok: false, reason: "NOTIONAL_TOO_LARGE", limit: 500 });
  });

  it("accepts a notional exactly at the cap", () => {
    expect(
      checkLimits({ ...baseInput, notional: 500 }, { ...unlimited, maxNotionalPerOrder: 500 })
    ).toEqual({ ok: true });
  });

  it("rejects when the daily order count is already at the cap", () => {
    const r = checkLimits({ ...baseInput, ordersToday: 10 }, { ...unlimited, maxOrdersPerDay: 10 });
    expect(r).toEqual({ ok: false, reason: "DAILY_LIMIT_REACHED", limit: 10 });
  });

  it("accepts when the daily count is one below the cap", () => {
    expect(
      checkLimits({ ...baseInput, ordersToday: 9 }, { ...unlimited, maxOrdersPerDay: 10 })
    ).toEqual({ ok: true });
  });

  it("rejects leverage above the cap", () => {
    const r = checkLimits({ ...baseInput, leverage: 50 }, { ...unlimited, maxLeverage: 20 });
    expect(r).toEqual({ ok: false, reason: "LEVERAGE_TOO_HIGH", limit: 20 });
  });

  it("rejects a symbol outside the allowlist", () => {
    const r = checkLimits(baseInput, { ...unlimited, allowedSymbols: ["ETH-USDT"] });
    expect(r).toEqual({ ok: false, reason: "SYMBOL_NOT_ALLOWED", limit: "ETH-USDT" });
  });

  it("accepts a symbol inside the allowlist", () => {
    expect(
      checkLimits(baseInput, { ...unlimited, allowedSymbols: ["BTC-USDT", "ETH-USDT"] })
    ).toEqual({ ok: true });
  });

  it("treats an empty allowlist as blocking everything", () => {
    expect(checkLimits(baseInput, { ...unlimited, allowedSymbols: [] }).ok).toBe(false);
  });

  it("reports the symbol rule before the size rule when both fail", () => {
    const r = checkLimits(
      { ...baseInput, notional: 9999 },
      { ...unlimited, maxNotionalPerOrder: 500, allowedSymbols: ["ETH-USDT"] }
    );
    expect(r).toMatchObject({ ok: false, reason: "SYMBOL_NOT_ALLOWED" });
  });

  it("reports the daily-limit rule before leverage and notional when all three fail", () => {
    const r = checkLimits(
      { ...baseInput, notional: 9999, leverage: 999, ordersToday: 10 },
      { ...unlimited, maxOrdersPerDay: 10, maxLeverage: 20, maxNotionalPerOrder: 500 }
    );
    expect(r).toMatchObject({ ok: false, reason: "DAILY_LIMIT_REACHED" });
  });

  it("reports the leverage rule before the notional rule when both fail", () => {
    const r = checkLimits(
      { ...baseInput, notional: 9999, leverage: 999 },
      { ...unlimited, maxLeverage: 20, maxNotionalPerOrder: 500 }
    );
    expect(r).toMatchObject({ ok: false, reason: "LEVERAGE_TOO_HIGH" });
  });
});
