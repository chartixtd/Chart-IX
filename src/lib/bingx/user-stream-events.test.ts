import { describe, it, expect } from "vitest";
import { parseFuturesStreamEvent, parseSpotStreamEvent, isListenKeyExpired } from "./user-stream-events";

describe("parseFuturesStreamEvent", () => {
  it("ORDER_TRADE_UPDATE invalidates both orders and positions (a fill changes both)", () => {
    const raw = { e: "ORDER_TRADE_UPDATE", E: 1700000000000, o: { s: "BTC-USDT", x: "TRADE", X: "FILLED" } };
    expect(parseFuturesStreamEvent(raw)).toEqual({ orders: true, positions: true, balance: false });
  });

  it("ACCOUNT_UPDATE invalidates positions and balance, not orders", () => {
    const raw = { e: "ACCOUNT_UPDATE", E: 1700000000000, a: { m: "ORDER", B: [], P: [] } };
    expect(parseFuturesStreamEvent(raw)).toEqual({ orders: false, positions: true, balance: true });
  });

  it("ACCOUNT_CONFIG_UPDATE (leverage/margin change) is not one of our invalidation targets", () => {
    const raw = { e: "ACCOUNT_CONFIG_UPDATE", ac: { s: "BTC-USDT", l: 20 } };
    expect(parseFuturesStreamEvent(raw)).toBeNull();
  });

  it("returns null for unrecognized event shapes instead of throwing", () => {
    expect(parseFuturesStreamEvent({})).toBeNull();
    expect(parseFuturesStreamEvent(null)).toBeNull();
  });
});

describe("isListenKeyExpired", () => {
  it("recognizes the listenKeyExpired push", () => {
    expect(isListenKeyExpired({ e: "listenKeyExpired", E: 1676964520421, listenKey: "abc" })).toBe(true);
  });

  it("is false for any other event", () => {
    expect(isListenKeyExpired({ e: "ORDER_TRADE_UPDATE" })).toBe(false);
    expect(isListenKeyExpired(null)).toBe(false);
  });
});

describe("parseSpotStreamEvent", () => {
  it("recognizes executionReport wrapped in a dataType envelope (ticker-style)", () => {
    const raw = { dataType: "spot.executionReport", data: { e: "executionReport", s: "BTC-USDT", X: "FILLED" } };
    expect(parseSpotStreamEvent(raw)).toEqual({ orders: true, positions: false, balance: false });
  });

  it("recognizes ACCOUNT_UPDATE via dataType even without a nested e field", () => {
    const raw = { dataType: "ACCOUNT_UPDATE", data: { a: { m: "ORDER", B: [] } } };
    expect(parseSpotStreamEvent(raw)).toEqual({ orders: false, positions: false, balance: true });
  });

  it("recognizes ACCOUNT_UPDATE via a top-level e field (unwrapped shape)", () => {
    const raw = { e: "ACCOUNT_UPDATE", a: { m: "ORDER", B: [] } };
    expect(parseSpotStreamEvent(raw)).toEqual({ orders: false, positions: false, balance: true });
  });

  it("returns null for unrecognized event shapes instead of throwing", () => {
    expect(parseSpotStreamEvent({})).toBeNull();
    expect(parseSpotStreamEvent(null)).toBeNull();
  });
});
