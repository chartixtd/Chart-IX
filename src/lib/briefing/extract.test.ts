import { describe, it, expect } from "vitest";
import { extractArticleText, BODY_MAX_CHARS } from "./extract";

const NAV_NOISE = `
<html><head><style>.a{color:red}</style><script>var x=1;</script></head>
<body>
  <nav><p>Home</p><p>Markets</p></nav>
  <div class="promo"><p>Subscribe</p></div>
`;

const REAL_PARAGRAPH =
  "Bitcoin held above the sixty five thousand dollar mark through Asian trading hours on Friday, " +
  "with traders pointing to steady spot demand rather than leverage as the driver of the move.";

describe("extractArticleText", () => {
  it("抽出正文段落", () => {
    const html = `${NAV_NOISE}<article><p>${REAL_PARAGRAPH}</p></article></body></html>`;
    expect(extractArticleText(html)).toContain("Bitcoin held above");
  });

  it("丢掉导航、订阅提示这类过短的段落", () => {
    const html = `${NAV_NOISE}<article><p>${REAL_PARAGRAPH}</p></article></body></html>`;
    const out = extractArticleText(html);
    expect(out).not.toContain("Home");
    expect(out).not.toContain("Markets");
    expect(out).not.toContain("Subscribe");
  });

  it("整块剔除 script/style，不把代码当正文", () => {
    const html = `<body><script>var secret="${"x".repeat(80)}";</script><p>${REAL_PARAGRAPH}</p></body>`;
    const out = extractArticleText(html);
    expect(out).not.toContain("var secret");
    expect(out).not.toContain("xxxxxxxx");
  });

  it("按上限截断", () => {
    const long = "这是一段足够长的正文内容，用来验证截断行为是否生效。".repeat(200);
    const html = `<body><p>${long}</p></body>`;
    expect(extractArticleText(html).length).toBe(BODY_MAX_CHARS);
  });

  it("自定义上限生效", () => {
    const html = `<body><p>${REAL_PARAGRAPH}</p></body>`;
    expect(extractArticleText(html, 50).length).toBe(50);
  });

  it("解码 HTML 实体，正文里不残留 &amp; 之类", () => {
    const p = "Powell said inflation &amp; growth remain the two variables the committee watches most closely now.";
    const html = `<body><p>${p}</p></body>`;
    const out = extractArticleText(html);
    expect(out).toContain("inflation & growth");
    expect(out).not.toContain("&amp;");
  });

  it("剥掉段落内嵌的行内标签", () => {
    const html = `<body><p>Bitcoin <strong>held above</strong> the sixty five thousand dollar mark through Asian trading hours today.</p></body>`;
    const out = extractArticleText(html);
    expect(out).toContain("Bitcoin held above the sixty five");
    expect(out).not.toContain("<strong>");
  });

  it("没有可用段落时返回空串——调用方据此退回 RSS 摘要", () => {
    expect(extractArticleText("<body><div>no paragraphs here</div></body>")).toBe("");
  });

  it("空输入不抛错", () => {
    expect(extractArticleText("")).toBe("");
  });

  it("多段正文按顺序拼接", () => {
    const p2 = "Gold tokens extended their advance for a third session as haven demand stayed firm across the region.";
    const html = `<body><p>${REAL_PARAGRAPH}</p><p>${p2}</p></body>`;
    const out = extractArticleText(html);
    expect(out.indexOf("Bitcoin held")).toBeLessThan(out.indexOf("Gold tokens"));
  });
});
