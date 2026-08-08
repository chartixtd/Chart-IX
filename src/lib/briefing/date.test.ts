import { describe, it, expect } from "vitest";
import { utcPlus8DateString, briefingSlug, windowStart24h } from "./date";

describe("utcPlus8DateString", () => {
  it("UTC 时间已是次日、UTC+8 也是次日", () => {
    // 2026-08-08T16:30:00Z -> UTC+8 是 2026-08-09 00:30
    expect(utcPlus8DateString(Date.parse("2026-08-08T16:30:00Z"))).toBe("2026-08-09");
  });

  it("UTC 仍是当日、UTC+8 已跨到次日", () => {
    // 2026-08-08T23:00:00Z -> UTC+8 是 2026-08-09 07:00
    expect(utcPlus8DateString(Date.parse("2026-08-08T23:00:00Z"))).toBe("2026-08-09");
  });

  it("早报实际触发时刻 UTC 00:00 对应 UTC+8 当日 08:00", () => {
    expect(utcPlus8DateString(Date.parse("2026-08-08T00:00:00Z"))).toBe("2026-08-08");
  });

  it("UTC 前一日晚间仍属 UTC+8 的次日", () => {
    // 2026-07-31T16:00:00Z -> UTC+8 是 2026-08-01 00:00，跨月
    expect(utcPlus8DateString(Date.parse("2026-07-31T16:00:00Z"))).toBe("2026-08-01");
  });

  it("跨年边界", () => {
    expect(utcPlus8DateString(Date.parse("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
});

describe("briefingSlug", () => {
  it("拼出固定前缀的 slug", () => {
    expect(briefingSlug("2026-08-08")).toBe("daily-briefing-2026-08-08");
  });
});

describe("windowStart24h", () => {
  it("正好回退 24 小时", () => {
    const now = Date.parse("2026-08-08T00:00:00Z");
    expect(windowStart24h(now)).toBe(Date.parse("2026-08-07T00:00:00Z"));
  });
});
