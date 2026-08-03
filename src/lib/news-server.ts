import { createTtlCache } from "@/lib/ttl-cache";
import type { NewsItem, NewsLang } from "@/types";

/**
 * 行业资讯源：均为公开 RSS，免费、无需 API key。
 * CryptoCompare 的新闻接口 2024 年起并入 CoinDesk 并要求付费 key，所以直接读 RSS —— 结构稳定，够用。
 * 中文资讯试过金色财经/律动/Odaily/PANews，都是纯前端 SPA 或已关闭 RSS，没有可用的免费接口；
 * 吴说区块链走 Substack 标准 RSS，是目前唯一能稳定拿到的中文源。
 * 每个源标了 lang，页面按当前语言只取对应语言的条目——中英文不混排。
 */
const FEEDS: { source: string; lang: NewsLang; url: string }[] = [
  { source: "CoinDesk", lang: "en", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", lang: "en", url: "https://cointelegraph.com/rss" },
  { source: "吴说区块链", lang: "zh", url: "https://wublockchain123.substack.com/feed" },
];

/** 5 分钟一刷新：新闻不需要秒级实时，太频繁只会白白打上游 */
const NEWS_TTL_MS = 5 * 60 * 1000;

/** 每个源各留这么多条再合并——CoinDesk/Cointelegraph 更新频率比吴说高得多，
 *  直接按全局时间排序取前 N 会把中文条目全挤掉，所以按源分别截断 */
const MAX_PER_FEED = 30;
const SUMMARY_MAX_LEN = 220;

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

async function fetchFeed(source: string, lang: NewsLang, url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Chart-IX/1.0)" },
    // RSS 源本身不带 Next 缓存语义，交给上层的 TTL 缓存统一管
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${source} feed responded ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
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
      source,
      lang,
      imageUrl: extractImage(block),
      publishedAt,
      summary: description ? stripHtml(description).slice(0, SUMMARY_MAX_LEN) : "",
    });
  }
  return items;
}

const cache = createTtlCache<NewsItem[]>({
  ttlMs: NEWS_TTL_MS,
  compute: async () => {
    const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f.source, f.lang, f.url)));
    const perFeed = results.map((r) =>
      r.status === "fulfilled"
        ? [...r.value].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_PER_FEED)
        : []
    );
    const items = perFeed.flat();
    if (items.length === 0) {
      // 单个源挂了不该拖垮整页，但全部源都失败就是真的没数据可给
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(firstError ? String(firstError.reason) : "No news sources returned data");
    }
    items.sort((a, b) => b.publishedAt - a.publishedAt);
    return items;
  },
});

/** lang 省略时返回全部；页面按当前站点语言只要一种语言的条目 */
export async function getNewsPayload(lang?: NewsLang): Promise<NewsItem[]> {
  const all = await cache.get();
  return lang ? all.filter((item) => item.lang === lang) : all;
}
