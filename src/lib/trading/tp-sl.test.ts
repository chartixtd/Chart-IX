import { describe, it, expect } from "vitest";
import { checkTpSlHit } from "./tp-sl";

describe("checkTpSlHit", () => {
  it("returns null when neither TP nor SL is set", () => {
    expect(checkTpSlHit("long", 100, null, null)).toBeNull();
  });

  it("long: hits TP when price rises to or past it", () => {
    expect(checkTpSlHit("long", 110, 110, null)).toBe("tp");
    expect(checkTpSlHit("long", 120, 110, null)).toBe("tp");
    expect(checkTpSlHit("long", 109.99, 110, null)).toBeNull();
  });

  it("long: hits SL when price falls to or past it", () => {
    expect(checkTpSlHit("long", 90, null, 90)).toBe("sl");
    expect(checkTpSlHit("long", 80, null, 90)).toBe("sl");
    expect(checkTpSlHit("long", 90.01, null, 90)).toBeNull();
  });

  it("short: TP is below entry, SL is above (inverted vs. long)", () => {
    expect(checkTpSlHit("short", 90, 90, null)).toBe("tp");
    expect(checkTpSlHit("short", 80, 90, null)).toBe("tp");
    expect(checkTpSlHit("short", 110, null, 110)).toBe("sl");
    expect(checkTpSlHit("short", 100, null, 110)).toBeNull();
  });

  it("prioritizes SL when a single tick crosses both (gap move)", () => {
    // long position, price gaps down through both TP (above, irrelevant) and SL
    expect(checkTpSlHit("long", 50, 200, 90)).toBe("sl");
    // short position, price gaps up through both SL and TP-below
    expect(checkTpSlHit("short", 300, 90, 110)).toBe("sl");
  });

  it("ignores non-finite prices", () => {
    expect(checkTpSlHit("long", NaN, 100, 90)).toBeNull();
    expect(checkTpSlHit("long", Infinity, 100, 90)).toBeNull();
  });
});
