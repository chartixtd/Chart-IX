import { describe, it, expect } from "vitest";
import { utcPlus8DateString, utcPlus8Hour, briefingSlug, windowStart24h } from "./date";

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

describe("utcPlus8Hour", () => {
  it("UTC 00:00 对应 UTC+8 的 8 点——发布窗口的起点", () => {
    expect(utcPlus8Hour(Date.parse("2026-08-08T00:00:00Z"))).toBe(8);
  });

  it("UTC 16:00 是 UTC+8 的日界，此刻是 0 点而不是早上", () => {
    // 这正是 I4 的场景：日期已经翻篇，但当地时间才 00:00，不该发"早报"
    expect(utcPlus8Hour(Date.parse("2026-08-08T16:00:00Z"))).toBe(0);
  });

  it("UTC 04:00 对应 UTC+8 的 12 点——已出发布窗口", () => {
    expect(utcPlus8Hour(Date.parse("2026-08-08T04:00:00Z"))).toBe(12);
  });

  it("UTC 03:59 仍是 UTC+8 的 11 点——窗口末端", () => {
    expect(utcPlus8Hour(Date.parse("2026-08-08T03:59:00Z"))).toBe(11);
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
