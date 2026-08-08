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

  it("经 sanitize 后内容不丢失", () => {
    const clean = sanitizeArticleHtml(renderFallbackHtml(FACTS, SOURCES, "zh-CN"));
    expect(clean).toContain("Bitcoin holds");
    expect(clean).toContain("$64,959.52");
  });
});
