import { describe, it, expect } from "vitest";
import { renderBriefingHtml, escapeHtml } from "./render";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import type { BriefingJson, MarketFact } from "./types";

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: -1.37 },
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
  const html = renderBriefingHtml(JSON_INPUT, FACTS, "zh-CN");

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

  // 正常稿刻意不列信息来源：一串外链是噪音，而源站标题全是英文，
  // 挂在中文正文后面就成了中英混排。分析本身已经是对这些新闻的提炼。
  it("正常稿不列信息来源，也不含任何外链", () => {
    expect(html).not.toContain("信息来源");
    expect(html).not.toContain("<a href");
    expect(html).not.toContain("CoinDesk");
  });

  it("英文正常稿同样不列来源", () => {
    const en = renderBriefingHtml(JSON_INPUT, FACTS, "en-US");
    expect(en).not.toContain("Sources");
    expect(en).not.toContain("<a href");
  });

  it("附免责声明", () => {
    expect(html).toContain("不构成投资建议");
  });

  it("转义模型输出中的 HTML，防注入", () => {
    const evil: BriefingJson = {
      ...JSON_INPUT,
      analysis: { ...JSON_INPUT.analysis, overview: "<img src=x onerror=alert(1)>" },
    };
    const out = renderBriefingHtml(evil, FACTS, "zh-CN");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("行情为空时不渲染行情区块，且不抛错", () => {
    const out = renderBriefingHtml(JSON_INPUT, [], "zh-CN");
    expect(out).toContain("总览");
  });

  // 回归防线：sanitizer 白名单若被收紧，这条会先红
  it("经 sanitizeArticleHtml 后不丢失任何预期内容", () => {
    const clean = sanitizeArticleHtml(html);
    expect(clean).toContain("要点一");
    expect(clean).toContain("$64,959.52");
    expect(clean).toContain("不构成投资建议");
  });

  it("sanitizer 会强制给链接加 rel 并剥掉 javascript 协议", () => {
    const withEvilLink = '<p><a href="javascript:alert(1)">x</a></p>';
    const clean = sanitizeArticleHtml(withEvilLink);
    expect(clean).not.toContain("javascript:");
  });

  it("英文稿使用英文免责声明", () => {
    const en = renderBriefingHtml(JSON_INPUT, FACTS, "en-US");
    expect(en).toContain("not investment advice");
  });

  it("中文稿行情用全角括号", () => {
    expect(html).toContain("（24h +0.92%）");
  });

  it("英文稿行情用半角括号，不混排全角", () => {
    const en = renderBriefingHtml(JSON_INPUT, FACTS, "en-US");
    expect(en).toContain("(24h +0.92%)");
    expect(en).not.toContain("（");
    expect(en).not.toContain("）");
  });

  // I1：sources.ts 允许每源 25 条 × 8 源 = 最多 200 条过 24h 过滤到这里，
  // 而 prompt 只喂了前 40 条。列出的来源必须正好是分析真正看过的那些。


  // 源站 url 是第三方数据，必须走完整渲染路径验证而不只是手写 HTML
  // 第三方 url 进入 HTML 的路径现在只剩兜底稿，对应覆盖在 fallback.test.ts
});
