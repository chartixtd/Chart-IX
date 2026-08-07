import { describe, it, expect } from "vitest";
import { classifyBarsUpdate, classifyTail, overlaySignature } from "./incremental";

describe("classifyBarsUpdate", () => {
  const prev = { earliest: 100, count: 3 };
  it("first load is full", () => {
    expect(classifyBarsUpdate({ earliest: null, count: 0 }, [100, 200, 300])).toBe("full");
  });
  it("same earliest same count is tick", () => {
    expect(classifyBarsUpdate(prev, [100, 200, 300])).toBe("tick");
  });
  it("same earliest count+1 is append", () => {
    expect(classifyBarsUpdate(prev, [100, 200, 300, 400])).toBe("append");
  });
  it("earlier first bar (prepend) is full", () => {
    expect(classifyBarsUpdate(prev, [50, 100, 200, 300])).toBe("full");
  });
  it("different earliest (symbol switch) is full", () => {
    expect(classifyBarsUpdate(prev, [900, 1000, 1100])).toBe("full");
  });
  it("count shrank is full", () => {
    expect(classifyBarsUpdate(prev, [100, 200])).toBe("full");
  });
  it("count grew by more than 1 is full", () => {
    expect(classifyBarsUpdate(prev, [100, 200, 300, 400, 500])).toBe("full");
  });
  it("empty times is full", () => {
    expect(classifyBarsUpdate(prev, [])).toBe("full");
  });
  // Sliding-window pagination: the latest-300 window can shift forward by one
  // (a bar closed) while the merged/deduped array's earliest bar also shifts
  // forward, keeping count constant — must not be mistaken for a same-window tick.
  it("earliest advanced by one step with count unchanged is full", () => {
    expect(classifyBarsUpdate(prev, [200, 300, 400])).toBe("full");
  });
  it("prev.count 0 with non-null earliest (inconsistent bookkeeping) is full", () => {
    expect(classifyBarsUpdate({ earliest: 100, count: 0 }, [100, 200, 300])).toBe("full");
  });
});

describe("classifyTail", () => {
  it("null prevLastTime is same", () => {
    expect(classifyTail(null, 100)).toBe("same");
  });
  it("equal last time is same", () => {
    expect(classifyTail(100, 100)).toBe("same");
  });
  it("advanced last time is advanced", () => {
    expect(classifyTail(100, 200)).toBe("advanced");
  });
  it("regressed last time is regressed", () => {
    expect(classifyTail(200, 100)).toBe("regressed");
  });
});

describe("overlaySignature", () => {
  it("is stable for same content in same order", () => {
    const a = overlaySignature([{ price: 1, color: "#f00", dashed: true, title: "TP" }]);
    const b = overlaySignature([{ price: 1, color: "#f00", dashed: true, title: "TP" }]);
    expect(a).toBe(b);
  });
  it("changes when any field changes", () => {
    const base = [{ price: 1, color: "#f00", dashed: true, title: "TP" }];
    expect(overlaySignature(base)).not.toBe(
      overlaySignature([{ ...base[0], price: 2 }])
    );
  });
  it("empty array has its own signature", () => {
    expect(overlaySignature([])).toBe("[]");
  });
  it("changes when items are reordered", () => {
    const a = { price: 1, color: "#f00", dashed: true, title: "TP" };
    const b = { price: 2, color: "#0f0", dashed: false, title: "SL" };
    expect(overlaySignature([a, b])).not.toBe(overlaySignature([b, a]));
  });
});
