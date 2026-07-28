import { describe, it, expect } from "vitest";
import { resolveOrderDirection } from "./account-mode";

describe("resolveOrderDirection in hedge mode", () => {
  it("maps LONG to BUY with positionSide LONG", () => {
    expect(resolveOrderDirection("LONG", true)).toEqual({ side: "BUY", positionSide: "LONG" });
  });

  it("maps SHORT to SELL with positionSide SHORT", () => {
    expect(resolveOrderDirection("SHORT", true)).toEqual({ side: "SELL", positionSide: "SHORT" });
  });
});

describe("resolveOrderDirection in one-way mode", () => {
  it("maps LONG to BUY with positionSide BOTH", () => {
    expect(resolveOrderDirection("LONG", false)).toEqual({ side: "BUY", positionSide: "BOTH" });
  });

  it("maps SHORT to SELL with positionSide BOTH", () => {
    expect(resolveOrderDirection("SHORT", false)).toEqual({ side: "SELL", positionSide: "BOTH" });
  });

  it("never emits LONG or SHORT as positionSide in one-way mode", () => {
    // 这正是错误码 109400 "PositionSide must be BOTH in one-way mode" 的成因
    for (const dir of ["LONG", "SHORT"] as const) {
      expect(resolveOrderDirection(dir, false).positionSide).toBe("BOTH");
    }
  });
});
