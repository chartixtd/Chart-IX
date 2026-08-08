import { describe, it, expect } from "vitest";
import { fallbackTitle, renderFallbackHtml } from "./fallback";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import type { BriefingSource, MarketFact } from "./types";

const SOURCES: BriefingSource[] = [
  { title: "Bitcoin holds", url: "https://e.com/a", source: "CoinDesk", publishedAt: 2, summary: "" },
  { title: "Gold record", url: "https://e.com/b", source: "Investing.com", publishedAt: 1, summary: "" },
];

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
];

describe("fallbackTitle", () => {
  it("中文标题含日期", () => {
    expect(fallbackTitle("zh-CN", "2026-08-08")).toContain("2026-08-08");
  });
  it("英文标题含日期", () => {
    expect(fallbackTitle("en-US", "2026-08-08")).toContain("2026-08-08");
  });
  it("标题长度落在质量门槛的区间内", () => {
    expect([...fallbackTitle("zh-CN", "2026-08-08")].length).toBeGreaterThanOrEqual(10);
    expect([...fallbackTitle("zh-CN", "2026-08-08")].length).toBeLessThanOrEqual(60);
  });
});

describe("renderFallbackHtml", () => {
  it("渲染全部新闻条目为链接", () => {
    const html = renderFallbackHtml(FACTS, SOURCES, "zh-CN");
    expect(html).toContain('href="https://e.com/a"');
    expect(html).toContain("Bitcoin holds");
    expect(html).toContain("Gold record");
  });

  it("渲染行情", () => {
    expect(renderFallbackHtml(FACTS, SOURCES, "zh-CN")).toContain("$64,959.52");
  });

  it("有新闻无行情时仍可出稿", () => {
    const html = renderFallbackHtml([], SOURCES, "zh-CN");
    expect(html).toContain("Bitcoin holds");
  });

  it("有行情无新闻时仍可出稿", () => {
    const html = renderFallbackHtml(FACTS, [], "zh-CN");
    expect(html).toContain("$64,959.52");
  });

  it("两者皆空返回空字符串，交由调用方判定不可出稿", () => {
    expect(renderFallbackHtml([], [], "zh-CN")).toBe("");
  });

  it("附免责声明", () => {
    expect(renderFallbackHtml(FACTS, SOURCES, "zh-CN")).toContain("不构成投资建议");
  });

  it("转义源站标题里的 HTML", () => {
    const evil: BriefingSource[] = [
      { title: "<script>x</script>", url: "https://e.com/c", source: "S", publishedAt: 1, summary: "" },
    ];
    const html = renderFallbackHtml([], evil, "zh-CN");
    expect(html).not.toContain("<script>");
  });

  // MAX_ITEMS=20 的截断此前无人钉住。改 render.ts 的来源上限时顺手补上，
  // 免得两处上限被误当成同一个而一起改掉——两者理由不同：兜底稿的列表就是正文
  //（读者会逐条扫），正常稿的列表是给分析做出处的。
  it("来源超过 20 条时按 MAX_ITEMS 截断", () => {
    const many: BriefingSource[] = Array.from({ length: 45 }, (_, i) => ({
      title: `news-${i}`,
      url: `https://e.com/${i}`,
      source: "S",
      publishedAt: 45 - i,
      summary: "",
    }));
    const html = renderFallbackHtml(FACTS, many, "zh-CN");
    expect(html).toContain("news-19");
    expect(html).not.toContain("news-20");
    expect(html.match(/<a href="https:\/\/e\.com\//g)).toHaveLength(20);
  });

  it("经 sanitize 后内容不丢失", () => {
    const clean = sanitizeArticleHtml(renderFallbackHtml(FACTS, SOURCES, "zh-CN"));
    expect(clean).toContain("Bitcoin holds");
    expect(clean).toContain("$64,959.52");
  });
});
