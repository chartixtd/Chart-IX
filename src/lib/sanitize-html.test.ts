import { describe, it, expect } from "vitest";
import { sanitizeArticleHtml } from "./sanitize-html";

describe("sanitizeArticleHtml — 正文配图", () => {
  it("保留上传得到的图片，连同 alt/title", () => {
    const html = sanitizeArticleHtml(
      '<p>before</p><img src="https://cdn.example.com/a-123.png" alt="chart" title="t"><p>after</p>'
    );
    expect(html).toContain('src="https://cdn.example.com/a-123.png"');
    expect(html).toContain('alt="chart"');
    expect(html).toContain('title="t"');
    expect(html).toContain("<p>before</p>");
  });

  it("多张图片都留下来——一篇文章可以配多图", () => {
    const html = sanitizeArticleHtml(
      '<img src="https://cdn.example.com/1.png"><img src="https://cdn.example.com/2.png"><img src="https://cdn.example.com/3.png">'
    );
    expect(html.match(/<img/g)).toHaveLength(3);
  });

  it("javascript: 伪协议的 src 不会活下来", () => {
    const html = sanitizeArticleHtml('<img src="javascript:alert(1)">');
    expect(html).not.toContain("javascript:");
  });

  it("data: URI 的 src 不会活下来——图片一律走上传拿公开 URL", () => {
    const html = sanitizeArticleHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
    expect(html).not.toContain("data:");
  });

  it("事件属性被丢弃", () => {
    const html = sanitizeArticleHtml(
      '<img src="https://cdn.example.com/a.png" onerror="alert(1)" onload="alert(2)">'
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onload");
    expect(html).toContain('src="https://cdn.example.com/a.png"');
  });

  it("样式属性被丢弃——不给正文改版式的口子", () => {
    const html = sanitizeArticleHtml(
      '<img src="https://cdn.example.com/a.png" style="position:fixed;width:100vw">'
    );
    expect(html).not.toContain("style");
  });
});

describe("sanitizeArticleHtml — 放开图片没有放松其余约束", () => {
  it("script 仍然整段丢掉", () => {
    expect(sanitizeArticleHtml('<p>ok</p><script>alert(1)</script>')).toBe("<p>ok</p>");
  });

  it("链接仍被强制加上 rel/target", () => {
    const html = sanitizeArticleHtml('<a href="https://example.com">x</a>');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("iframe 之类的嵌入仍然进不来", () => {
    expect(sanitizeArticleHtml('<iframe src="https://evil.example"></iframe>')).toBe("");
  });
});
