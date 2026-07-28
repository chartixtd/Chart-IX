import { describe, it, expect, vi, beforeEach } from "vitest";

const getPositionSideDual = vi.fn();

vi.mock("@/lib/bingx/futures", () => ({
  getPositionSideDual: (...args: unknown[]) => getPositionSideDual(...args),
}));

const { resolveOrderDirection, getDualSideMode, invalidateDualSideMode } = await import(
  "./account-mode"
);

beforeEach(() => {
  getPositionSideDual.mockReset().mockResolvedValue({ dualSidePosition: true });
});

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

// getDualSideMode / invalidateDualSideMode: cached IO layer.
// Each test uses a distinct userId so the module-level cache from one test
// cannot bleed into another (there is no exported reset helper, and adding
// one just for tests would widen the module's public surface).
describe("getDualSideMode", () => {
  it("coalesces concurrent calls for the same user into a single upstream call", async () => {
    let resolveUpstream!: (v: { dualSidePosition: boolean }) => void;
    getPositionSideDual.mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolveUpstream = resolve;
      })
    );

    const calls = [
      getDualSideMode("user-dedup", "key", "secret"),
      getDualSideMode("user-dedup", "key", "secret"),
      getDualSideMode("user-dedup", "key", "secret"),
    ];
    resolveUpstream({ dualSidePosition: true });
    const results = await Promise.all(calls);

    expect(results).toEqual([true, true, true]);
    expect(getPositionSideDual).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected upstream call, and retries fresh on the next call", async () => {
    getPositionSideDual.mockReset().mockRejectedValueOnce(new Error("upstream down"));
    await expect(getDualSideMode("user-reject", "key", "secret")).rejects.toThrow("upstream down");
    expect(getPositionSideDual).toHaveBeenCalledTimes(1);

    getPositionSideDual.mockResolvedValueOnce({ dualSidePosition: true });
    expect(await getDualSideMode("user-reject", "key", "secret")).toBe(true);
    expect(getPositionSideDual).toHaveBeenCalledTimes(2);
  });

  it("isolates concurrent calls for different users: each fires its own upstream call with its own value", async () => {
    getPositionSideDual.mockReset().mockImplementation(async (apiKey: string) => {
      return { dualSidePosition: apiKey === "key-hedge" };
    });

    const [hedge, oneWay] = await Promise.all([
      getDualSideMode("user-a", "key-hedge", "secret"),
      getDualSideMode("user-b", "key-oneway", "secret"),
    ]);

    expect(hedge).toBe(true);
    expect(oneWay).toBe(false);
    expect(getPositionSideDual).toHaveBeenCalledTimes(2);
  });

  it("invalidateDualSideMode forces a refetch on the next call", async () => {
    getPositionSideDual.mockReset().mockResolvedValue({ dualSidePosition: true });

    expect(await getDualSideMode("user-invalidate", "key", "secret")).toBe(true);
    expect(getPositionSideDual).toHaveBeenCalledTimes(1);

    // still cached: no second call
    expect(await getDualSideMode("user-invalidate", "key", "secret")).toBe(true);
    expect(getPositionSideDual).toHaveBeenCalledTimes(1);

    invalidateDualSideMode("user-invalidate");

    expect(await getDualSideMode("user-invalidate", "key", "secret")).toBe(true);
    expect(getPositionSideDual).toHaveBeenCalledTimes(2);
  });

  it("coerces the wire value: literal true and string \"true\" are hedge mode; everything else is one-way", async () => {
    const cases: Array<[unknown, boolean, string]> = [
      [true, true, "user-coerce-bool-true"],
      ["true", true, "user-coerce-string-true"],
      [undefined, false, "user-coerce-undefined"],
      [null, false, "user-coerce-null"],
      [1, false, "user-coerce-number"],
    ];

    for (const [wireValue, expected, userId] of cases) {
      getPositionSideDual.mockReset().mockResolvedValue({ dualSidePosition: wireValue });
      expect(await getDualSideMode(userId, "key", "secret")).toBe(expected);
    }
  });
});
