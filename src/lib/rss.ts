/**
 * 通用 RSS 解析。原先是 news-server.ts 的模块私有实现，早报需要完全相同的
 * 解析行为（尤其是 Substack 中文数字实体解码、Investing.com 非 RFC822 日期），
 * 复制一份会让两处随时间发散，故抽取共用。
 */
export interface RssItem {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  /** ms epoch */
  publishedAt: number;
  summary: string;
}

const DEFAULT_SUMMARY_MAX_LEN = 220;

/**
 * 单个源的抓取超时。
 *
 * 原先没有任何 AbortSignal，undici 默认的 header/body 超时是 300 秒。
 * 以前只有带 TTL 缓存的资讯页在调它，慢一次是可接受的；每日早报把它放上了
 * 无人值守的关键路径：fetchBriefingSources 用 allSettled 等**全部** 8 个源，
 * 一个卡住的源就能在生成还没开始前吃掉整个 60 秒函数预算，落进那条
 * 「无文章、无心跳、无告警」的被杀路径。
 *
 * 8 秒对一个 RSS 源足够宽松，卡住的源会被 allSettled 记为 rejected 并跳过。
 */
const FEED_TIMEOUT_MS = 8_000;

function decodeEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // Substack 的中文 feed 把每个汉字都编成十进制数字实体（&#26410; 等），
    // 得先解出来，不然中文来源全篇都是乱码
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : null;
}

function extractImage(block: string): string | null {
  const media =
    block.match(/<media:content[^>]*url="([^"]+)"/i) ||
    block.match(/<media:thumbnail[^>]*url="([^"]+)"/i);
  if (media) return media[1];
  const enclosure = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i);
  if (enclosure) return enclosure[1];
  // 兜底：从 description 里塞的 <img src="..."> 里抠一张
  const imgInDesc = block.match(/<img[^>]*src="([^"]+)"/i);
  return imgInDesc ? imgInDesc[1] : null;
}

/** 纯解析，不发请求——便于用固定 XML 做测试 */
export function parseRssItems(
  xml: string,
  summaryMaxLen: number = DEFAULT_SUMMARY_MAX_LEN
): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDateStr = extractTag(block, "pubDate");
    if (!title || !link || !pubDateStr) continue;
    const publishedAt = Date.parse(pubDateStr);
    if (Number.isNaN(publishedAt)) continue;

    const description = extractTag(block, "description");
    const guid = extractTag(block, "guid");
    items.push({
      id: guid ?? link,
      title,
      url: link.split("?")[0],
      imageUrl: extractImage(block),
      publishedAt,
      summary: description ? stripHtml(description).slice(0, summaryMaxLen) : "",
    });
  }
  return items;
}

/**
 * `label` 用于错误消息，缺省回落到 url。**调用方应当传源名**：这个错误会经
 * news-server.ts 的全源失败分支一路传到 NewsClient 的空状态并直接渲染给访客，
 * 写 url 等于把上游 RSS 地址暴露在页面上。
 */
export async function fetchRssFeed(
  url: string,
  label?: string,
  summaryMaxLen: number = DEFAULT_SUMMARY_MAX_LEN
): Promise<RssItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Chart-IX/1.0)" },
    // RSS 源本身不带 Next 缓存语义，交给上层的 TTL 缓存统一管
    cache: "no-store",
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${label ?? url} feed responded ${res.status}`);
  return parseRssItems(await res.text(), summaryMaxLen);
}
