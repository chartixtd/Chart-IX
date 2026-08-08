import { fetchRssFeed } from "@/lib/rss";
import { windowStart24h } from "./date";
import type { BriefingSource } from "./types";

/**
 * 早报源清单。与资讯页（news-server.ts）的源**刻意分开**：资讯页按语言分栏
 * 展示原始条目、需要中文源；早报由模型改写，源是什么语言无所谓，因此优先选
 * 覆盖面而非语种。
 *
 * 全部于 2026-08-08 实测可用（HTTP 200 且有条目）。已实测不可用、不要再加：
 * Kitco KitcoNews.xml (404)、RSSHub 金十 (403)、华尔街见闻 rss.xml (200 但零条目)、
 * Reuters 与 marketwatch.com/rss/topstories (均 301)。
 */
export const BRIEFING_FEEDS: { source: string; url: string }[] = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "吴说区块链", url: "https://wublockchain123.substack.com/feed" },
  { source: "Investing.com", url: "https://www.investing.com/rss/commodities.rss" },
  { source: "FXStreet", url: "https://www.fxstreet.com/rss/news" },
  { source: "CNBC", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { source: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { source: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
];

/**
 * 低于此数不调用模型，直接走零 AI 兜底稿。8 个源在正常一天可产出数十条，
 * 低于 10 条意味着多数源已失效，此时让模型硬写只会得到注水内容。
 */
export const MIN_SOURCE_ITEMS = 10;

/** 每个源最多取这么多条，避免更新频繁的源把其他源挤掉 */
const MAX_PER_FEED = 25;

/** 24 小时窗口过滤 + 按 url 去重 + 时间倒序 */
export function filterLast24h(items: BriefingSource[], nowMs: number): BriefingSource[] {
  const start = windowStart24h(nowMs);
  const seen = new Set<string>();
  const out: BriefingSource[] = [];
  for (const item of items) {
    // 上界用 nowMs：源站时钟走快会给出未来时间，那种条目不该进"过去 24 小时"
    if (item.publishedAt < start || item.publishedAt > nowMs) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

/** 抓全部源。单个源失败不影响整体——沿用 news-server 的 allSettled 模式 */
export async function fetchBriefingSources(nowMs: number): Promise<BriefingSource[]> {
  const results = await Promise.allSettled(
    BRIEFING_FEEDS.map(async (feed) => {
      const items = await fetchRssFeed(feed.url, feed.source);
      return items
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, MAX_PER_FEED)
        .map<BriefingSource>((it) => ({
          title: it.title,
          url: it.url,
          source: feed.source,
          publishedAt: it.publishedAt,
          summary: it.summary,
        }));
    })
  );

  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      console.error(`[briefing] feed failed: ${BRIEFING_FEEDS[i].source}`, r.reason);
    }
  }

  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return filterLast24h(all, nowMs);
}
