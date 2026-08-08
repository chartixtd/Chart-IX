import { describe, it, expect } from "vitest";
import { renderBriefingHtml, escapeHtml } from "./render";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import type { BriefingJson, MarketFact, BriefingSource } from "./types";

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: -1.37 },
];

const SOURCES: BriefingSource[] = [
  { title: "Bitcoin holds", url: "https://example.com/a", source: "CoinDesk", publishedAt: 1, summary: "" },
];

const JSON_INPUT: BriefingJson = {
  title: "早报 | 测试标题足够长",
  summary: "导读",
  headlines: [{ topic: "加密货币", points: ["要点一", "要点二"] }],
  analysis: { overview: "总览", crypto: "加密", gold: "黄金", watchlist: ["关注一"] },
};

describe("escapeHtml", () => {
  it("转义会破坏结构的字符", () => {
    expect(escapeHtml('<script>&"')).toBe("&lt;script&gt;&amp;&quot;");
  });
});

describe("renderBriefingHtml", () => {
  const html = renderBriefingHtml(JSON_INPUT, FACTS, SOURCES, "zh-CN");

  it("渲染要闻要点", () => {
    expect(html).toContain("要点一");
    expect(html).toContain("要点二");
  });

  it("渲染分析各段", () => {
    expect(html).toContain("总览");
    expect(html).toContain("加密");
    expect(html).toContain("黄金");
    expect(html).toContain("关注一");
  });

  it("行情用列表而非表格渲染", () => {
    expect(html).toContain("<ul>");
    expect(html).not.toContain("<table");
  });

  it("行情含价格与带符号的涨跌幅", () => {
    expect(html).toContain("$64,959.52");
    expect(html).toContain("+0.92%");
    expect(html).toContain("-1.37%");
  });

  it("来源渲染为链接", () => {
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain("CoinDesk");
  });

  it("附免责声明", () => {
    expect(html).toContain("不构成投资建议");
  });

  it("转义模型输出中的 HTML，防注入", () => {
    const evil: BriefingJson = {
      ...JSON_INPUT,
      analysis: { ...JSON_INPUT.analysis, overview: "<img src=x onerror=alert(1)>" },
    };
    const out = renderBriefingHtml(evil, FACTS, SOURCES, "zh-CN");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("行情为空时不渲染行情区块，且不抛错", () => {
    const out = renderBriefingHtml(JSON_INPUT, [], SOURCES, "zh-CN");
    expect(out).toContain("总览");
  });

  // 回归防线：sanitizer 白名单若被收紧，这条会先红
  it("经 sanitizeArticleHtml 后不丢失任何预期内容", () => {
    const clean = sanitizeArticleHtml(html);
    expect(clean).toContain("要点一");
    expect(clean).toContain("$64,959.52");
    expect(clean).toContain("不构成投资建议");
    expect(clean).toContain('href="https://example.com/a"');
  });

  it("sanitizer 会强制给链接加 rel 并剥掉 javascript 协议", () => {
    const withEvilLink = '<p><a href="javascript:alert(1)">x</a></p>';
    const clean = sanitizeArticleHtml(withEvilLink);
    expect(clean).not.toContain("javascript:");
  });

  it("英文稿使用英文免责声明", () => {
    const en = renderBriefingHtml(JSON_INPUT, FACTS, SOURCES, "en-US");
    expect(en).toContain("not investment advice");
  });
});
