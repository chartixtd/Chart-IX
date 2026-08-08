import { describe, it, expect } from "vitest";
import { parseRssItems } from "./rss";

const RFC822 = `<rss><channel>
<item>
  <title>Bitcoin holds above 64k</title>
  <link>https://example.com/a?utm_source=rss</link>
  <pubDate>Fri, 07 Aug 2026 21:51:00 GMT</pubDate>
  <description>&lt;p&gt;Some &lt;b&gt;html&lt;/b&gt; body&lt;/p&gt;</description>
  <guid>guid-a</guid>
</item>
</channel></rss>`;

// Investing.com 用的非 RFC822 格式——黄金源就是这个格式，
// 解析失败会让整个黄金源静默消失，必须锁死
const INVESTING = `<rss><channel>
<item>
  <title>Gold hits record</title>
  <link>https://example.com/gold</link>
  <pubDate>Aug 07, 2026 20:16 GMT</pubDate>
  <description>Gold rose</description>
</item>
</channel></rss>`;

// Substack 中文 feed 把每个汉字编成十进制实体
const SUBSTACK = `<rss><channel>
<item>
  <title>&#21556;&#35828;</title>
  <link>https://example.com/wu</link>
  <pubDate>Fri, 07 Aug 2026 10:00:00 GMT</pubDate>
  <description>&#27979;&#35797;</description>
</item>
</channel></rss>`;

describe("parseRssItems", () => {
  it("解析标准 RFC822 条目并剥掉 query 与 HTML", () => {
    const items = parseRssItems(RFC822);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Bitcoin holds above 64k");
    expect(items[0].url).toBe("https://example.com/a");
    expect(items[0].summary).toBe("Some html body");
    expect(items[0].id).toBe("guid-a");
    expect(items[0].publishedAt).toBe(Date.parse("2026-08-07T21:51:00Z"));
  });

  it("解析 Investing.com 的非 RFC822 日期格式（黄金源）", () => {
    const items = parseRssItems(INVESTING);
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBe(Date.parse("2026-08-07T20:16:00Z"));
  });

  it("解码十进制数字实体的中文标题", () => {
    const items = parseRssItems(SUBSTACK);
    expect(items[0].title).toBe("吴说");
    expect(items[0].summary).toBe("测试");
  });

  it("缺 title/link/pubDate 的条目直接丢弃", () => {
    const xml = `<rss><channel><item><title>only title</title></item></channel></rss>`;
    expect(parseRssItems(xml)).toHaveLength(0);
  });

  it("日期无法解析的条目丢弃", () => {
    const xml = `<rss><channel><item>
      <title>t</title><link>https://e.com</link><pubDate>not a date</pubDate>
    </item></channel></rss>`;
    expect(parseRssItems(xml)).toHaveLength(0);
  });

  it("summary 按上限截断，缺省 220", () => {
    const long = "x".repeat(500);
    const xml = `<rss><channel><item>
      <title>t</title><link>https://e.com</link>
      <pubDate>Fri, 07 Aug 2026 10:00:00 GMT</pubDate>
      <description>${long}</description>
    </item></channel></rss>`;
    expect(parseRssItems(xml)[0].summary).toHaveLength(220);
    expect(parseRssItems(xml, 50)[0].summary).toHaveLength(50);
  });

  it("guid 缺失时用 link 兜底作为 id", () => {
    const items = parseRssItems(INVESTING);
    expect(items[0].id).toBe("https://example.com/gold");
  });
});
