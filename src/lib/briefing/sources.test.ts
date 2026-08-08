import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BriefingSource } from "./types";

const fetchRssFeed = vi.fn();
vi.mock("@/lib/rss", () => ({
  fetchRssFeed: (...args: unknown[]) => fetchRssFeed(...args),
}));

const { BRIEFING_FEEDS, MIN_SOURCE_ITEMS, filterLast24h, fetchBriefingSources } = await import(
  "./sources"
);

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

// Task 3 遗留的缺口：容错路径此前零覆盖。早报无人值守，单源失效是常态
// （终审前已经实测出 4 个源 404/403/301），必须钉住「坏源不拖垮整轮」。
describe("fetchBriefingSources — 容错", () => {
  function rss(hoursAgo: number, title: string) {
    return {
      id: title,
      title,
      url: `https://e.com/${title}`,
      imageUrl: null,
      publishedAt: NOW - hoursAgo * 3600_000,
      summary: "s",
    };
  }

  beforeEach(() => {
    fetchRssFeed.mockReset();
    // 坏源会走 console.error，是预期行为；别让它把测试输出淹掉
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("单个源抛错时其余源照常产出", async () => {
    fetchRssFeed.mockImplementation(async (_url: string, label: string) => {
      if (label === "CoinDesk") throw new Error("feed responded 404");
      return [rss(1, label)];
    });
    const out = await fetchBriefingSources(NOW);
    expect(out).toHaveLength(BRIEFING_FEEDS.length - 1);
    expect(out.some((s) => s.source === "CoinDesk")).toBe(false);
  });

  it("全部源都失败时返回空数组而不是抛出——调用方据此走 L5 判定", async () => {
    fetchRssFeed.mockRejectedValue(new Error("boom"));
    await expect(fetchBriefingSources(NOW)).resolves.toEqual([]);
  });

  it("每源最多取 25 条，避免高频源把其他源挤掉", async () => {
    fetchRssFeed.mockImplementation(async (_url: string, label: string) =>
      Array.from({ length: 40 }, (_, i) => rss(i * 0.1, `${label}-${i}`))
    );
    const out = await fetchBriefingSources(NOW);
    expect(out.filter((s) => s.source === "CoinDesk")).toHaveLength(25);
  });

  it("源名与条目字段被正确带出，并已过 24h 窗口过滤", async () => {
    fetchRssFeed.mockImplementation(async (_url: string, label: string) =>
      label === "CNBC" ? [rss(1, "fresh"), rss(30, "stale")] : []
    );
    const out = await fetchBriefingSources(NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "fresh", source: "CNBC", summary: "s" });
  });
});
