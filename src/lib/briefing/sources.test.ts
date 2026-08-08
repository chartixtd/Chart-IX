import { describe, it, expect } from "vitest";
import { BRIEFING_FEEDS, MIN_SOURCE_ITEMS, filterLast24h } from "./sources";
import type { BriefingSource } from "./types";

const NOW = Date.parse("2026-08-08T00:00:00Z");

function src(hoursAgo: number, title = "t"): BriefingSource {
  return {
    title,
    url: `https://e.com/${hoursAgo}`,
    source: "S",
    publishedAt: NOW - hoursAgo * 3600_000,
    summary: "",
  };
}

describe("BRIEFING_FEEDS", () => {
  it("固定 8 个源", () => {
    expect(BRIEFING_FEEDS).toHaveLength(8);
  });

  it("含黄金/大宗源 Investing.com Commodities", () => {
    expect(BRIEFING_FEEDS.some((f) => f.url.includes("investing.com/rss/commodities"))).toBe(true);
  });

  it("不含已实测不可用的源", () => {
    const urls = BRIEFING_FEEDS.map((f) => f.url).join(" ");
    expect(urls).not.toContain("kitco.com");
    expect(urls).not.toContain("rsshub.app");
    expect(urls).not.toContain("wallstreetcn.com");
  });

  it("每个源的 url 唯一", () => {
    expect(new Set(BRIEFING_FEEDS.map((f) => f.url)).size).toBe(BRIEFING_FEEDS.length);
  });
});

describe("filterLast24h", () => {
  it("保留 24 小时内的条目", () => {
    expect(filterLast24h([src(1), src(23)], NOW)).toHaveLength(2);
  });

  it("剔除超过 24 小时的条目", () => {
    expect(filterLast24h([src(25), src(48)], NOW)).toHaveLength(0);
  });

  it("剔除未来时间的条目（源站时钟错误）", () => {
    expect(filterLast24h([src(-5)], NOW)).toHaveLength(0);
  });

  it("按时间倒序返回", () => {
    const out = filterLast24h([src(10, "old"), src(1, "new")], NOW);
    expect(out.map((s) => s.title)).toEqual(["new", "old"]);
  });

  it("按 url 去重，同一条被多源转载只留一次", () => {
    const a: BriefingSource = { ...src(1), url: "https://e.com/same" };
    const b: BriefingSource = { ...src(2), url: "https://e.com/same" };
    expect(filterLast24h([a, b], NOW)).toHaveLength(1);
  });
});

describe("MIN_SOURCE_ITEMS", () => {
  it("阈值为 10", () => {
    expect(MIN_SOURCE_ITEMS).toBe(10);
  });
});
