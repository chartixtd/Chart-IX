# 每日 AI 市场早报 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天 UTC+8 08:00 自动抓取 24 小时新闻与真实行情，调用 DeepSeek 生成一篇中英双语市场早报并发布到 `articles`，异常时降级到零 AI 兜底稿，保证每天必有一篇上线。

**Architecture:** 单条 Next.js cron 路由 `/api/cron/daily-briefing` 串起五步流水线（幂等闸门 → 取素材 → 生成 → 质量门槛 → 落库）。业务逻辑全部拆为 `src/lib/briefing/` 下的纯函数以便独立测试，路由只做编排。调度复用既有 GitHub Actions tick，在早上时间窗内多次幂等触发。

**Tech Stack:** Next.js 15 App Router、TypeScript、Supabase（service-role client）、vitest、DeepSeek API（OpenAI 兼容格式）、BingX 公开行情接口、RSS。

设计文档：`docs/superpowers/specs/2026-08-08-daily-briefing-design.md`

## Global Constraints

- **行情 24h 涨跌只能来自现货 ticker** `getSpotTickers()`。合约 ticker 的 `priceChangePercent` 只有约 3 分钟窗口（实测 BTC 合约报 0.00% 而现货报 0.92%），**任何情况下不得用于早报**。
- **黄金只用 `XAUT-USDT` 与 `PAXG-USDT`**，不用 `NCCOGOLD2USD-USDT`（现货盘不存在，且代币化商品周末休市无数据）。
- 现货接口 `priceChangePercent` 是**带百分号的字符串**（`"0.92%"`），`openPrice`/`lastPrice` 返回**数字**而非类型声明的 `string`。一律 `parseFloat(String(v))` 归一。
- **只生成 `zh-CN` 与 `en-US`**。`en-US` 缺失会让英文与马来文读者看到空白正文，是硬性必需项。
- 早报标的集固定为：`BTC-USDT`、`ETH-USDT`、`SOL-USDT`、`BNB-USDT`、`XRP-USDT`、`DOGE-USDT`、`XAUT-USDT`、`PAXG-USDT`。
- 早报 RSS 源固定为 8 个：CoinDesk、Cointelegraph、吴说区块链、Investing.com Commodities、FXStreet、CNBC Finance、Yahoo Finance、Federal Reserve Press。
- `MIN_SOURCE_ITEMS = 10`：24h 内有效新闻少于此数不调用模型，直接走兜底。
- 数字核对容差：**价格 ±0.5%，百分比 ±0.2 个百分点**。
- 模型名不得硬编码：`DEEPSEEK_MODEL` 默认 `deepseek-v4-flash`，`DEEPSEEK_FALLBACK_MODEL` 默认 `deepseek-v4-pro`。
- 迁移**不得**写入 `feature_flags`（该表已于 038 删除）。
- slug 格式固定 `daily-briefing-YYYY-MM-DD`，按 **UTC+8** 日界计算。
- 测试命令为 `npx vitest run <path>`；vitest 只收集 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts`。
- 所有新文件注释用中文，与 `src/lib/` 既有风格一致。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `src/lib/briefing/types.ts` | 全部共享类型 |
| `src/lib/briefing/date.ts` | UTC+8 日界、slug、24h 窗口边界 |
| `src/lib/rss.ts` | 通用 RSS 解析（自 `news-server.ts` 抽取） |
| `src/lib/briefing/sources.ts` | 早报源清单、抓取、24h 过滤 |
| `src/lib/briefing/market-facts.ts` | 现货 ticker → 行情事实集 |
| `src/lib/briefing/quality-gate.ts` | 质量门槛全部规则 |
| `src/lib/briefing/render.ts` | `BriefingJson` → HTML |
| `src/lib/briefing/fallback.ts` | 零 AI 兜底稿 |
| `src/lib/briefing/prompt.ts` | 中英 prompt 构造 |
| `src/lib/briefing/deepseek.ts` | DeepSeek 客户端 |
| `src/lib/briefing/alert.ts` | 降级/失败告警（Sentry + 可选 Telegram） |
| `src/lib/briefing/run.ts` | 流水线主体 `runDailyBriefing` |
| `src/lib/translate.ts` | Google Translate 通道（自 admin 路由抽取） |
| `src/app/api/cron/daily-briefing/route.ts` | cron 入口（鉴权 + 调用 `run.ts`） |
| `src/app/api/admin/briefing/run-now/route.ts` | 后台手动触发 |
| `supabase/migrations/041_daily_briefing.sql` | 分类 + 推送开关 |

**修改**

| 文件 | 改动 |
|---|---|
| `src/lib/news-server.ts` | 改为复用 `src/lib/rss.ts`，行为不变 |
| `src/lib/sanitize-html.ts` | 白名单增加 `<a>` |
| `src/app/api/admin/articles/translate/route.ts` | 改为复用 `src/lib/translate.ts` |
| `.github/workflows/cron-tick.yml` | 新增 daily-briefing step |
| `.env.local.example` | 补 4 个环境变量占位 |

---

## Task 0: 前置条件——提交并验证 cron-tick.yml

**为什么是 Task 0：** `git ls-files .github` 返回 0，该 workflow 从未被提交，GitHub 上并不存在。当前线上 `telegram-push` 与 `price-alerts` 没有任何调度器在触发。早报依赖同一个 workflow，不先修好就会以同样方式静默不触发。

**Files:**
- Commit: `.github/workflows/cron-tick.yml`（已存在于工作区，未被跟踪）

- [ ] **Step 1: 确认该文件确实未被跟踪**

```bash
git ls-files .github | wc -l
```

Expected: `0`

- [ ] **Step 2: 提交并推送**

`.gitignore` 含 `docs/` 与 `*.md` 但**不含** `.github`，普通 `git add` 即可。

```bash
git add .github/workflows/cron-tick.yml
git commit -m "ci: 提交 cron-tick 调度 workflow（此前只存在于本地，线上无调度器）"
git push
```

- [ ] **Step 3: 手动触发一次并确认执行**

到 GitHub 仓库 Actions 页面，选择 `cron-tick`，点 "Run workflow"（该 workflow 已定义 `workflow_dispatch: {}`）。确认出现运行记录且两个 step 均返回 HTTP < 500。

- [ ] **Step 4: 验证心跳真的更新了**

在 Supabase SQL Editor 执行：

```sql
SELECT job_name, last_run_at, last_status FROM public.cron_heartbeats;
```

Expected: `telegram-push` 与 `price-alerts` 的 `last_run_at` 是刚刚的时间。若时间戳陈旧，说明请求没打通，**先解决再继续后面的任务**。

---

## Task 1: 共享类型与 UTC+8 日界

**Files:**
- Create: `src/lib/briefing/types.ts`
- Create: `src/lib/briefing/date.ts`
- Test: `src/lib/briefing/date.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `BriefingSource`、`MarketFact`、`BriefingJson`、`BriefingLocale` 类型
  - `utcPlus8DateString(nowMs: number): string`
  - `briefingSlug(dateStr: string): string`
  - `windowStart24h(nowMs: number): number`

- [ ] **Step 1: 写类型文件**

`src/lib/briefing/types.ts`：

```ts
/** 早报只出这两种语言——ms-MY 由文章详情页的回退链显示英文版 */
export type BriefingLocale = "zh-CN" | "en-US";

/** 一条早报素材新闻（比 NewsItem 少 lang/imageUrl，早报不需要） */
export interface BriefingSource {
  title: string;
  url: string;
  source: string;
  /** ms epoch */
  publishedAt: number;
  summary: string;
}

/** 一条行情事实。change24hPct 必须来自现货 ticker——合约 ticker 只有 ~3 分钟窗口 */
export interface MarketFact {
  /** 交易对，如 "BTC-USDT" */
  symbol: string;
  /** 展示名，如 "BTC" */
  label: string;
  lastPrice: number;
  change24hPct: number;
}

/** DeepSeek 必须返回的结构。字段缺失或为空由质量门槛拦截 */
export interface BriefingJson {
  title: string;
  summary: string;
  headlines: { topic: string; points: string[] }[];
  analysis: {
    overview: string;
    crypto: string;
    gold: string;
    watchlist: string[];
  };
}
```

- [ ] **Step 2: 写失败的日期测试**

`src/lib/briefing/date.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { utcPlus8DateString, briefingSlug, windowStart24h } from "./date";

describe("utcPlus8DateString", () => {
  it("UTC 时间已是次日、UTC+8 也是次日", () => {
    // 2026-08-08T16:30:00Z -> UTC+8 是 2026-08-09 00:30
    expect(utcPlus8DateString(Date.parse("2026-08-08T16:30:00Z"))).toBe("2026-08-09");
  });

  it("UTC 仍是当日、UTC+8 已跨到次日", () => {
    // 2026-08-08T23:00:00Z -> UTC+8 是 2026-08-09 07:00
    expect(utcPlus8DateString(Date.parse("2026-08-08T23:00:00Z"))).toBe("2026-08-09");
  });

  it("早报实际触发时刻 UTC 00:00 对应 UTC+8 当日 08:00", () => {
    expect(utcPlus8DateString(Date.parse("2026-08-08T00:00:00Z"))).toBe("2026-08-08");
  });

  it("UTC 前一日晚间仍属 UTC+8 的次日", () => {
    // 2026-07-31T16:00:00Z -> UTC+8 是 2026-08-01 00:00，跨月
    expect(utcPlus8DateString(Date.parse("2026-07-31T16:00:00Z"))).toBe("2026-08-01");
  });

  it("跨年边界", () => {
    expect(utcPlus8DateString(Date.parse("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
});

describe("briefingSlug", () => {
  it("拼出固定前缀的 slug", () => {
    expect(briefingSlug("2026-08-08")).toBe("daily-briefing-2026-08-08");
  });
});

describe("windowStart24h", () => {
  it("正好回退 24 小时", () => {
    const now = Date.parse("2026-08-08T00:00:00Z");
    expect(windowStart24h(now)).toBe(Date.parse("2026-08-07T00:00:00Z"));
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/date.test.ts`
Expected: FAIL，报找不到模块 `./date`

- [ ] **Step 4: 实现 date.ts**

`src/lib/briefing/date.ts`：

```ts
/**
 * 早报的日界一律按 UTC+8 计算——服务器跑在 UTC，若直接用 UTC 日期，
 * UTC+8 早上 8 点（UTC 00:00）出的稿在跨月/跨年时会挂到前一天，
 * slug 与文章日期对不上。
 */
const UTC_PLUS_8_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 返回 UTC+8 时区下的 YYYY-MM-DD */
export function utcPlus8DateString(nowMs: number): string {
  // 把时间轴整体平移 8 小时后按 UTC 取日期，等价于在 UTC+8 下取日期，
  // 且不依赖运行环境的本地时区（Vercel 是 UTC，本地开发可能不是）
  return new Date(nowMs + UTC_PLUS_8_OFFSET_MS).toISOString().slice(0, 10);
}

/** 文章 slug。articles.slug 有 UNIQUE 约束，这也是本功能的幂等闸门 */
export function briefingSlug(dateStr: string): string {
  return `daily-briefing-${dateStr}`;
}

/** 素材窗口起点：当前时刻回退 24 小时 */
export function windowStart24h(nowMs: number): number {
  return nowMs - 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/date.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 6: 提交**

```bash
git add src/lib/briefing/types.ts src/lib/briefing/date.ts src/lib/briefing/date.test.ts
git commit -m "feat(briefing): 共享类型与 UTC+8 日界计算"
```

---

## Task 2: 抽取通用 RSS 解析

**为什么要抽取：** 早报需要与资讯页完全相同的 RSS 解析（含 Substack 中文数字实体解码那类踩过的坑）。复制一份会让两处行为随时间发散。抽取后 `news-server.ts` 只保留自己的 `lang` 标注与 TTL 缓存，**外部行为必须不变**。

**Files:**
- Create: `src/lib/rss.ts`
- Modify: `src/lib/news-server.ts`
- Test: `src/lib/rss.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `RssItem` 类型：`{ id: string; title: string; url: string; imageUrl: string | null; publishedAt: number; summary: string }`
  - `parseRssItems(xml: string, summaryMaxLen?: number): RssItem[]`
  - `fetchRssFeed(url: string, label?: string, summaryMaxLen?: number): Promise<RssItem[]>`

> **`label` 参数不是可有可无的。** 抛出的错误会一路传到用户界面：`news-server.ts:52` 重抛 → `news/page.tsx:38` 转字符串 → `NewsClient.tsx:68` 直接渲染进空状态。若报错里写 url，全源失败时访客会在页面上看到完整的上游 RSS 地址。`label` 让报错保持原来的「CoinDesk feed responded 500」形态。

- [ ] **Step 1: 写失败的解析测试**

`src/lib/rss.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/rss.test.ts`
Expected: FAIL，找不到模块 `./rss`

- [ ] **Step 3: 实现 rss.ts**

把 `news-server.ts` 里的 `decodeEntities` / `stripHtml` / `extractTag` / `extractImage` 原样搬过来（**不要改逻辑**），只把 `fetchFeed` 拆成「取文本」与「解析」两半。

`src/lib/rss.ts`：

```ts
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
  });
  if (!res.ok) throw new Error(`${label ?? url} feed responded ${res.status}`);
  return parseRssItems(await res.text(), summaryMaxLen);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/rss.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 改造 news-server.ts 复用它**

把 `src/lib/news-server.ts` 顶部的 `decodeEntities`、`stripHtml`、`extractTag`、`extractImage`、`SUMMARY_MAX_LEN` 与整个 `fetchFeed` 删除，替换为：

```ts
import { createTtlCache } from "@/lib/ttl-cache";
import { fetchRssFeed } from "@/lib/rss";
import type { NewsItem, NewsLang } from "@/types";
```

并把 `fetchFeed` 改成薄封装（其余代码、注释、常量一律不动）：

```ts
async function fetchFeed(source: string, lang: NewsLang, url: string): Promise<NewsItem[]> {
  // 传 source 作为 label：抛出的错误会渲染进新闻页空状态，不能是裸 url
  const items = await fetchRssFeed(url, source);
  return items.map((it) => ({
    id: it.id,
    title: it.title,
    url: it.url,
    source,
    lang,
    imageUrl: it.imageUrl,
    publishedAt: it.publishedAt,
    summary: it.summary,
  }));
}
```

- [ ] **Step 6: 确认类型检查通过、既有测试未回归**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: 无类型错误；全部既有测试仍通过。

- [ ] **Step 7: 提交**

```bash
git add src/lib/rss.ts src/lib/rss.test.ts src/lib/news-server.ts
git commit -m "refactor(rss): 抽取通用 RSS 解析供早报与资讯页共用，行为不变"
```

---

## Task 3: 早报素材源

**Files:**
- Create: `src/lib/briefing/sources.ts`
- Test: `src/lib/briefing/sources.test.ts`

**Interfaces:**
- Consumes: `RssItem`、`fetchRssFeed`（Task 2）；`BriefingSource`（Task 1）
- Produces:
  - `BRIEFING_FEEDS: { source: string; url: string }[]`
  - `MIN_SOURCE_ITEMS = 10`
  - `filterLast24h(items: BriefingSource[], nowMs: number): BriefingSource[]`
  - `fetchBriefingSources(nowMs: number): Promise<BriefingSource[]>`

- [ ] **Step 1: 写失败的测试**

`src/lib/briefing/sources.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { BRIEFING_FEEDS, MIN_SOURCE_ITEMS, filterLast24h } from "./sources";
import type { BriefingSource } from "./types";

const NOW = Date.parse("2026-08-08T00:00:00Z");

function src(hoursAgo: number, title = "t"): BriefingSource {
  return {
    title,
    url: `https://e.com/${title}`,
    source: "S",
    publishedAt: NOW - hoursAgo * 3600_000,
    summary: "",
  };
}

describe("BRIEFING_FEEDS", () => {
  it("固定 8 个源", () => {
    expect(BRIEFING_FEEDS).toHaveLength(8);
  });

  it("含黄金/大宗源 Investing.com Commodities", () => {
    expect(BRIEFING_FEEDS.some((f) => f.url.includes("investing.com/rss/commodities"))).toBe(true);
  });

  it("不含已实测不可用的源", () => {
    const urls = BRIEFING_FEEDS.map((f) => f.url).join(" ");
    expect(urls).not.toContain("kitco.com");
    expect(urls).not.toContain("rsshub.app");
    expect(urls).not.toContain("wallstreetcn.com");
  });

  it("每个源的 url 唯一", () => {
    expect(new Set(BRIEFING_FEEDS.map((f) => f.url)).size).toBe(BRIEFING_FEEDS.length);
  });
});

describe("filterLast24h", () => {
  it("保留 24 小时内的条目", () => {
    expect(filterLast24h([src(1), src(23)], NOW)).toHaveLength(2);
  });

  it("剔除超过 24 小时的条目", () => {
    expect(filterLast24h([src(25), src(48)], NOW)).toHaveLength(0);
  });

  it("剔除未来时间的条目（源站时钟错误）", () => {
    expect(filterLast24h([src(-5)], NOW)).toHaveLength(0);
  });

  it("按时间倒序返回", () => {
    const out = filterLast24h([src(10, "old"), src(1, "new")], NOW);
    expect(out.map((s) => s.title)).toEqual(["new", "old"]);
  });

  it("按 url 去重，同一条被多源转载只留一次", () => {
    const a: BriefingSource = { ...src(1), url: "https://e.com/same" };
    const b: BriefingSource = { ...src(2), url: "https://e.com/same" };
    expect(filterLast24h([a, b], NOW)).toHaveLength(1);
  });
});

describe("MIN_SOURCE_ITEMS", () => {
  it("阈值为 10", () => {
    expect(MIN_SOURCE_ITEMS).toBe(10);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/sources.test.ts`
Expected: FAIL，找不到模块 `./sources`

- [ ] **Step 3: 实现 sources.ts**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/sources.test.ts`
Expected: PASS（10 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/briefing/sources.ts src/lib/briefing/sources.test.ts
git commit -m "feat(briefing): 早报素材源清单与 24h 窗口过滤"
```

---

## Task 4: 行情事实集

**Files:**
- Create: `src/lib/briefing/market-facts.ts`
- Test: `src/lib/briefing/market-facts.test.ts`

**Interfaces:**
- Consumes: `MarketFact`（Task 1）；`getSpotTickers` from `@/lib/bingx/market`
- Produces:
  - `BRIEFING_SYMBOLS: { symbol: string; label: string }[]`
  - `buildMarketFacts(tickers: unknown[]): MarketFact[]`
  - `fetchMarketFacts(): Promise<MarketFact[]>`

- [ ] **Step 1: 写失败的测试**

`src/lib/briefing/market-facts.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { BRIEFING_SYMBOLS, buildMarketFacts } from "./market-facts";

// 形态照抄 2026-08-08 现货接口实测响应：
// priceChangePercent 是带百分号的字符串，价格字段是数字而非类型声明的 string
const REAL_SHAPE = [
  { symbol: "BTC-USDT", lastPrice: 64959.52, openPrice: 64369.69, priceChangePercent: "0.92%" },
  { symbol: "ETH-USDT", lastPrice: 1914.99, openPrice: 1903.71, priceChangePercent: "0.59%" },
  { symbol: "XAUT-USDT", lastPrice: 4325.51, openPrice: 4267.19, priceChangePercent: "1.37%" },
  { symbol: "NOTWANTED-USDT", lastPrice: 1, openPrice: 1, priceChangePercent: "0.00%" },
];

describe("BRIEFING_SYMBOLS", () => {
  it("黄金用 XAUT/PAXG，不用合约独有的 NCCOGOLD", () => {
    const symbols = BRIEFING_SYMBOLS.map((s) => s.symbol);
    expect(symbols).toContain("XAUT-USDT");
    expect(symbols).toContain("PAXG-USDT");
    expect(symbols).not.toContain("NCCOGOLD2USD-USDT");
  });

  it("含全部核心加密标的", () => {
    const symbols = BRIEFING_SYMBOLS.map((s) => s.symbol);
    for (const s of ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT", "DOGE-USDT"]) {
      expect(symbols).toContain(s);
    }
  });
});

describe("buildMarketFacts", () => {
  it("只取清单内的标的", () => {
    const facts = buildMarketFacts(REAL_SHAPE);
    expect(facts.map((f) => f.symbol)).not.toContain("NOTWANTED-USDT");
    expect(facts).toHaveLength(3);
  });

  it("剥掉百分号并转成数字", () => {
    const btc = buildMarketFacts(REAL_SHAPE).find((f) => f.symbol === "BTC-USDT")!;
    expect(btc.change24hPct).toBe(0.92);
    expect(btc.lastPrice).toBe(64959.52);
  });

  it("负涨跌正确解析", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: 100, openPrice: 110, priceChangePercent: "-9.09%" },
    ]);
    expect(facts[0].change24hPct).toBe(-9.09);
  });

  it("字符串形态的价格也接受（类型声明是 string）", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: "64959.52", openPrice: "64369.69", priceChangePercent: "0.92%" },
    ]);
    expect(facts[0].lastPrice).toBe(64959.52);
  });

  it("openPrice 为 0 的坏数据被剔除（会产生天文数字涨跌幅）", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: 100, openPrice: 0, priceChangePercent: "822096901.00%" },
    ]);
    expect(facts).toHaveLength(0);
  });

  it("涨跌幅无法解析时剔除", () => {
    const facts = buildMarketFacts([
      { symbol: "BTC-USDT", lastPrice: 100, openPrice: 90, priceChangePercent: "n/a" },
    ]);
    expect(facts).toHaveLength(0);
  });

  it("空输入返回空数组，不抛错", () => {
    expect(buildMarketFacts([])).toEqual([]);
  });

  it("label 是去掉 -USDT 的简称", () => {
    const btc = buildMarketFacts(REAL_SHAPE).find((f) => f.symbol === "BTC-USDT")!;
    expect(btc.label).toBe("BTC");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/market-facts.test.ts`
Expected: FAIL，找不到模块 `./market-facts`

- [ ] **Step 3: 实现 market-facts.ts**

```ts
import { getSpotTickers } from "@/lib/bingx/market";
import { hasUsableQuote } from "@/lib/instruments";
import type { MarketFact } from "./types";

/**
 * 早报标的集。全部于 2026-08-08 实测存在于现货盘。
 *
 * 黄金取 XAUT（Tether Gold）与 PAXG（Paxos Gold）两个黄金代币，**不取**
 * NCCOGOLD2USD-USDT：后者是合约独有的代币化标的，现货盘没有它，拿不到真
 * 24h 涨跌；且代币化商品周末与假日休市（BingX 休市期间 ticker/K线/深度
 * 一律返回 109415，见 instruments.ts），而早报每天都跑，必然撞上周末。
 * 黄金代币 24/7 交易，两者互为交叉校验（实测 +1.37% / +1.43%）。
 */
export const BRIEFING_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "BTC-USDT", label: "BTC" },
  { symbol: "ETH-USDT", label: "ETH" },
  { symbol: "SOL-USDT", label: "SOL" },
  { symbol: "BNB-USDT", label: "BNB" },
  { symbol: "XRP-USDT", label: "XRP" },
  { symbol: "DOGE-USDT", label: "DOGE" },
  { symbol: "XAUT-USDT", label: "XAUT" },
  { symbol: "PAXG-USDT", label: "PAXG" },
];

interface RawTicker {
  symbol?: unknown;
  lastPrice?: unknown;
  openPrice?: unknown;
  priceChangePercent?: unknown;
}

/**
 * 现货 ticker → 行情事实集。
 *
 * 必须用现货：合约 ticker 的 priceChangePercent 只是 ~3 分钟窗口（同刻实测
 * BTC 合约 0.00% vs 现货 0.92%），拿它当 24h 会让早报每天说谎且不报错。
 * 现货实测 openTime→closeTime 恰为 86400000ms，是真 24 小时。
 *
 * 字段形态：priceChangePercent 是带百分号的字符串（"0.92%"），价格字段实际
 * 返回数字而非类型声明的 string——一律 parseFloat(String(v)) 归一。
 */
export function buildMarketFacts(tickers: unknown[]): MarketFact[] {
  const bySymbol = new Map<string, RawTicker>();
  for (const t of tickers) {
    const raw = t as RawTicker;
    if (typeof raw?.symbol === "string") bySymbol.set(raw.symbol, raw);
  }

  const facts: MarketFact[] = [];
  for (const { symbol, label } of BRIEFING_SYMBOLS) {
    const raw = bySymbol.get(symbol);
    if (!raw) continue;

    const lastPrice = parseFloat(String(raw.lastPrice));
    const openPrice = parseFloat(String(raw.openPrice));
    // 复用既有判据：openPrice 为 0 的坏数据会产生天文数字涨跌幅
    if (!hasUsableQuote({ lastPrice, openPrice: String(openPrice) })) continue;

    const change24hPct = parseFloat(String(raw.priceChangePercent));
    if (!Number.isFinite(change24hPct)) continue;

    facts.push({ symbol, label, lastPrice, change24hPct });
  }
  return facts;
}

export async function fetchMarketFacts(): Promise<MarketFact[]> {
  return buildMarketFacts(await getSpotTickers());
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/market-facts.test.ts`
Expected: PASS（10 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/briefing/market-facts.ts src/lib/briefing/market-facts.test.ts
git commit -m "feat(briefing): 现货 24h 行情事实集（黄金用 XAUT/PAXG）"
```

---

## Task 5: 质量门槛

这是本功能最重要的一环。**数字核对只作用于 `analysis.*`，不作用于 `headlines`**——新闻摘要里本来就会出现 CPI、利率等不属于我们行情事实集的百分比，对它们做核对会产生大量误报。

**Files:**
- Create: `src/lib/briefing/quality-gate.ts`
- Test: `src/lib/briefing/quality-gate.test.ts`

**Interfaces:**
- Consumes: `BriefingJson`、`MarketFact`、`BriefingLocale`、`BriefingSource`（Task 1、3）
- Produces:
  - `GateFailure = { rule: string; detail: string }`
  - `GateResult = { ok: boolean; failures: GateFailure[] }`
  - `extractPrices(text: string): number[]`
  - `extractPercents(text: string): number[]`
  - `parseBriefingJson(raw: string): BriefingJson | null`
  - `checkBriefing(input: { json: unknown; facts: MarketFact[]; sources: BriefingSource[]; locale: BriefingLocale; finishReason: string | null }): GateResult`

- [ ] **Step 1: 写失败的测试**

`src/lib/briefing/quality-gate.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { extractPrices, extractPercents, parseBriefingJson, checkBriefing } from "./quality-gate";
import type { BriefingJson, MarketFact, BriefingSource } from "./types";

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: 1.37 },
];

const SOURCES: BriefingSource[] = [
  { title: "美国 CPI 同比 3.1%", url: "https://e.com/1", source: "CNBC", publishedAt: 0, summary: "" },
];

function validJson(over: Partial<BriefingJson> = {}): BriefingJson {
  return {
    title: "早报 | 8月8日 比特币小幅上行，黄金续创新高",
    summary: "过去二十四小时加密市场温和上行，黄金延续强势，宏观面关注美联储表态。",
    headlines: [
      { topic: "加密货币", points: ["比特币在六万四千美元上方震荡", "以太坊跟随小幅走高"] },
      { topic: "黄金与大宗", points: ["黄金代币续创阶段新高"] },
    ],
    analysis: {
      overview:
        "过去二十四小时市场整体偏暖，风险资产与避险资产同步走高，反映资金面宽松而非单边押注方向，这种组合通常出现在宏观预期尚未收敛的阶段，市场在等待更明确的指引。",
      crypto:
        "BTC 报 $64,959.52，二十四小时上涨 0.92%，涨幅温和且未伴随异常放量，属于区间内的正常波动，尚不足以判定趋势发生改变，需要观察后续成交能否跟上。",
      gold:
        "黄金代币 XAUT 报 $4,325.51，二十四小时上涨 1.37%，强于加密资产，显示避险需求仍在，这与近期宏观不确定性上升的背景一致，值得持续留意其与实际利率的关系。",
      watchlist: ["关注美联储官员讲话", "关注黄金能否站稳阶段高位"],
    },
    ...over,
  };
}

function check(json: unknown, finishReason: string | null = "stop") {
  return checkBriefing({ json, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason });
}

describe("extractPrices", () => {
  it("抽取带 $ 与千分位的价格", () => {
    expect(extractPrices("BTC 报 $64,959.52 上行")).toEqual([64959.52]);
  });
  it("抽取多个价格", () => {
    expect(extractPrices("$1,000 与 $2.5")).toEqual([1000, 2.5]);
  });
  it("不把裸数字当价格", () => {
    expect(extractPrices("2026 年 8 月 8 日，共 12 条")).toEqual([]);
  });
});

describe("extractPercents", () => {
  it("抽取正负百分比", () => {
    expect(extractPercents("上涨 0.92%，下跌 -1.5%")).toEqual([0.92, -1.5]);
  });
  it("无百分比时返回空", () => {
    expect(extractPercents("没有数字")).toEqual([]);
  });
});

describe("parseBriefingJson", () => {
  it("解析裸 JSON", () => {
    expect(parseBriefingJson('{"title":"t"}')).toEqual({ title: "t" });
  });
  it("解析被 ```json 围栏包裹的输出", () => {
    expect(parseBriefingJson('```json\n{"title":"t"}\n```')).toEqual({ title: "t" });
  });
  it("空字符串返回 null（DeepSeek 文档明示会偶发空内容）", () => {
    expect(parseBriefingJson("")).toBeNull();
  });
  it("非法 JSON 返回 null", () => {
    expect(parseBriefingJson("{not json")).toBeNull();
  });
});

describe("checkBriefing", () => {
  it("合格稿通过", () => {
    expect(check(validJson()).ok).toBe(true);
  });

  it("finish_reason 为 length 判定截断", () => {
    const r = check(validJson(), "length");
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "truncated")).toBe(true);
  });

  it("缺字段判定结构不完整", () => {
    const r = check({ title: "t" });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("headlines 少于 2 个主题不通过", () => {
    const r = check(validJson({ headlines: [{ topic: "加密货币", points: ["a"] }] }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("标题过短不通过", () => {
    const r = check(validJson({ title: "早报" }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "length")).toBe(true);
  });

  it("编造的价格被抓出", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("$64,959.52", "$99,999.00");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("价格在 ±0.5% 容差内视为正确（允许模型四舍五入）", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("$64,959.52", "$65,000.00");
    expect(check(j).ok).toBe(true);
  });

  it("编造的涨跌幅被抓出", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "7.50%");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("涨跌幅在 ±0.2 个百分点内视为正确", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "1.00%");
    expect(check(j).ok).toBe(true);
  });

  it("headlines 里来自新闻的百分比不参与核对（避免误报）", () => {
    const j = validJson();
    j.headlines[0].points.push("美国 CPI 同比 3.1%");
    expect(check(j).ok).toBe(true);
  });

  it("analysis 中引用源文里出现过的数字不算编造", () => {
    const j = validJson();
    j.analysis.overview += "市场消化了 3.1% 的通胀读数，情绪趋于稳定，短期内仍以震荡为主。";
    expect(check(j).ok).toBe(true);
  });

  it("禁用表述被抓出", () => {
    const j = validJson();
    j.analysis.watchlist = ["建议买入 BTC"];
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "banned-phrase")).toBe(true);
  });

  it("英文禁用表述同样被抓出", () => {
    const j = validJson();
    j.analysis.overview = "We recommend buying now. " + j.analysis.overview;
    const r = checkBriefing({
      json: j, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.failures.some((f) => f.rule === "banned-phrase")).toBe(true);
  });

  it("中文稿写成英文被判语言串台", () => {
    const j = validJson({
      summary: "Over the past twenty four hours the market moved higher across the board today.",
    });
    j.analysis.overview =
      "Over the past twenty four hours risk assets and safe havens both advanced, which usually happens when macro expectations have not converged and market participants are waiting for clearer guidance from policymakers.";
    j.analysis.crypto =
      "Bitcoin traded at sixty four thousand and change over the session, with a mild advance that did not come with unusual volume, so the range remains intact for now and needs confirmation.";
    j.analysis.gold =
      "Gold tokens extended their advance during the period, outperforming crypto assets and signalling that hedging demand is still present across the broader market today.";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "language")).toBe(true);
  });

  it("分析段落过短不通过", () => {
    const j = validJson();
    j.analysis.overview = "涨了。";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "length")).toBe(true);
  });

  it("null 输入不抛错，判定结构不完整", () => {
    const r = check(null);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/quality-gate.test.ts`
Expected: FAIL，找不到模块 `./quality-gate`

- [ ] **Step 3: 实现 quality-gate.ts**

```ts
import type { BriefingJson, BriefingLocale, BriefingSource, MarketFact } from "./types";

export interface GateFailure {
  rule: string;
  detail: string;
}

export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
}

/** 价格容差：允许模型四舍五入 */
const PRICE_TOLERANCE_RATIO = 0.005;
/** 百分比容差，单位是"个百分点" */
const PERCENT_TOLERANCE_PP = 0.2;

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const SUMMARY_MIN = 20;
const SUMMARY_MAX = 120;
const SECTION_MIN = 80;
const SECTION_MAX = 600;
/** 渲染后正文总长下限，用于兜住"结构齐全但内容稀薄"的半截输出 */
const BODY_MIN = 400;
/** 中文稿的 CJK 字符占比下限；英文稿的 CJK 占比上限 */
const CJK_RATIO_MIN = 0.3;
const CJK_RATIO_MAX = 0.05;

const BANNED_PHRASES = [
  "建议买入", "建议卖出", "目标价", "止损位", "必涨", "必跌", "梭哈", "稳赚", "包赚", "满仓",
  "recommend buying", "recommend selling", "price target", "stop loss", "guaranteed",
  "sure thing", "all in", "will definitely",
];

/** 价格必须带 $ 才被视为价格——裸数字会把年份、条数一并卷进来 */
const PRICE_RE = /\$\s*(\d[\d,]*(?:\.\d+)?)/g;
const PERCENT_RE = /(-?\d+(?:\.\d+)?)\s*%/g;

export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function extractPercents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PERCENT_RE)) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * 解析模型输出。即便开了 JSON 模式，模型偶尔仍会包一层 ``` 围栏；
 * 空内容是 DeepSeek 文档明示的已知问题，这里统一归一成 null 交给调用方重试。
 */
export function parseBriefingJson(raw: string): BriefingJson | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" ? (parsed as BriefingJson) : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function cjkRatio(text: string): number {
  const chars = [...text];
  if (chars.length === 0) return 0;
  const cjk = chars.filter((c) => /[一-鿿]/.test(c)).length;
  return cjk / chars.length;
}

function checkStructure(json: unknown): { failures: GateFailure[]; briefing: BriefingJson | null } {
  const failures: GateFailure[] = [];
  const b = json as BriefingJson | null;

  if (!b || typeof b !== "object") {
    return { failures: [{ rule: "structure", detail: "不是对象" }], briefing: null };
  }
  if (!isNonEmptyString(b.title)) failures.push({ rule: "structure", detail: "title 缺失或为空" });
  if (!isNonEmptyString(b.summary)) failures.push({ rule: "structure", detail: "summary 缺失或为空" });

  if (!Array.isArray(b.headlines) || b.headlines.length < 2) {
    failures.push({ rule: "structure", detail: "headlines 少于 2 个主题" });
  } else {
    for (const h of b.headlines) {
      if (!isNonEmptyString(h?.topic) || !Array.isArray(h?.points) || h.points.length === 0) {
        failures.push({ rule: "structure", detail: `headlines 条目不完整: ${JSON.stringify(h)}` });
      }
    }
  }

  const a = b.analysis;
  if (!a || typeof a !== "object") {
    failures.push({ rule: "structure", detail: "analysis 缺失" });
  } else {
    for (const key of ["overview", "crypto", "gold"] as const) {
      if (!isNonEmptyString(a[key])) {
        failures.push({ rule: "structure", detail: `analysis.${key} 缺失或为空` });
      }
    }
    if (!Array.isArray(a.watchlist) || a.watchlist.length === 0) {
      failures.push({ rule: "structure", detail: "analysis.watchlist 缺失或为空" });
    }
  }

  return { failures, briefing: failures.length === 0 ? b : null };
}

function checkLengths(b: BriefingJson): GateFailure[] {
  const failures: GateFailure[] = [];
  const titleLen = [...b.title].length;
  if (titleLen < TITLE_MIN || titleLen > TITLE_MAX) {
    failures.push({ rule: "length", detail: `title 长度 ${titleLen} 不在 ${TITLE_MIN}-${TITLE_MAX}` });
  }
  const summaryLen = [...b.summary].length;
  if (summaryLen < SUMMARY_MIN || summaryLen > SUMMARY_MAX) {
    failures.push({ rule: "length", detail: `summary 长度 ${summaryLen} 不在 ${SUMMARY_MIN}-${SUMMARY_MAX}` });
  }
  for (const key of ["overview", "crypto", "gold"] as const) {
    const len = [...b.analysis[key]].length;
    if (len < SECTION_MIN || len > SECTION_MAX) {
      failures.push({ rule: "length", detail: `analysis.${key} 长度 ${len} 不在 ${SECTION_MIN}-${SECTION_MAX}` });
    }
  }
  const bodyLen = [...analysisText(b), ...headlinesText(b)].length;
  if (bodyLen < BODY_MIN) {
    failures.push({ rule: "length", detail: `正文总长 ${bodyLen} 低于 ${BODY_MIN}` });
  }
  return failures;
}

/** 只有这部分参与数字核对——headlines 是新闻转述，含大量不属于行情事实的数字 */
function analysisText(b: BriefingJson): string {
  return [b.analysis.overview, b.analysis.crypto, b.analysis.gold, ...b.analysis.watchlist].join("\n");
}

function headlinesText(b: BriefingJson): string {
  return b.headlines.map((h) => `${h.topic}\n${h.points.join("\n")}`).join("\n");
}

function fullText(b: BriefingJson): string {
  return [b.title, b.summary, headlinesText(b), analysisText(b)].join("\n");
}

/**
 * 数字幻觉核对。作用域限定在 analysis：headlines 是对新闻的转述，里面的
 * CPI、利率、涨跌数据来自源文而非我们的行情事实集，一并核对会产生大量误报。
 * analysis 中若引用了源文里出现过的数字，同样放行。
 */
function checkNumbers(b: BriefingJson, facts: MarketFact[], sources: BriefingSource[]): GateFailure[] {
  const failures: GateFailure[] = [];
  const text = analysisText(b);
  const sourceText = sources.map((s) => `${s.title} ${s.summary}`).join(" ");
  const sourcePrices = new Set(extractPrices(sourceText));
  const sourcePercents = new Set(extractPercents(sourceText));

  for (const price of extractPrices(text)) {
    if (sourcePrices.has(price)) continue;
    const matched = facts.some(
      (f) => Math.abs(price - f.lastPrice) <= f.lastPrice * PRICE_TOLERANCE_RATIO
    );
    if (!matched) {
      failures.push({ rule: "hallucinated-number", detail: `价格 $${price} 不在行情事实集内` });
    }
  }

  for (const pct of extractPercents(text)) {
    if (sourcePercents.has(pct)) continue;
    const matched = facts.some((f) => Math.abs(pct - f.change24hPct) <= PERCENT_TOLERANCE_PP);
    if (!matched) {
      failures.push({ rule: "hallucinated-number", detail: `涨跌幅 ${pct}% 不在行情事实集内` });
    }
  }
  return failures;
}

function checkBannedPhrases(b: BriefingJson): GateFailure[] {
  const text = fullText(b).toLowerCase();
  return BANNED_PHRASES.filter((p) => text.includes(p.toLowerCase())).map((p) => ({
    rule: "banned-phrase",
    detail: `含禁用表述「${p}」`,
  }));
}

function checkLanguage(b: BriefingJson, locale: BriefingLocale): GateFailure[] {
  const ratio = cjkRatio(fullText(b));
  if (locale === "zh-CN" && ratio < CJK_RATIO_MIN) {
    return [{ rule: "language", detail: `中文稿 CJK 占比仅 ${ratio.toFixed(2)}` }];
  }
  if (locale === "en-US" && ratio > CJK_RATIO_MAX) {
    return [{ rule: "language", detail: `英文稿 CJK 占比达 ${ratio.toFixed(2)}` }];
  }
  return [];
}

export function checkBriefing(input: {
  json: unknown;
  facts: MarketFact[];
  sources: BriefingSource[];
  locale: BriefingLocale;
  finishReason: string | null;
}): GateResult {
  const failures: GateFailure[] = [];

  if (input.finishReason === "length") {
    failures.push({ rule: "truncated", detail: "finish_reason 为 length，输出被截断" });
  }

  const { failures: structureFailures, briefing } = checkStructure(input.json);
  failures.push(...structureFailures);

  // 结构不完整时后续规则没有可靠的字段可读，直接返回
  if (!briefing) return { ok: false, failures };

  failures.push(...checkLengths(briefing));
  failures.push(...checkNumbers(briefing, input.facts, input.sources));
  failures.push(...checkBannedPhrases(briefing));
  failures.push(...checkLanguage(briefing, input.locale));

  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/quality-gate.test.ts`
Expected: PASS（26 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/briefing/quality-gate.ts src/lib/briefing/quality-gate.test.ts
git commit -m "feat(briefing): 质量门槛——结构/长度/数字幻觉/禁用表述/语言串台"
```

---

## Task 6: HTML 渲染与 sanitizer 扩展

**Files:**
- Create: `src/lib/briefing/render.ts`
- Modify: `src/lib/sanitize-html.ts`
- Test: `src/lib/briefing/render.test.ts`

**Interfaces:**
- Consumes: `BriefingJson`、`MarketFact`、`BriefingSource`、`BriefingLocale`
- Produces:
  - `escapeHtml(s: string): string`
  - `formatPrice(n: number): string`、`formatPct(n: number): string`
  - `renderMarketList(facts: MarketFact[]): string`、`renderSourceList(sources: BriefingSource[]): string`
  - `renderBriefingHtml(b: BriefingJson, facts: MarketFact[], sources: BriefingSource[], locale: BriefingLocale): string`
  - `DISCLAIMER: Record<BriefingLocale, string>`

> 行情列表与来源列表**必须**由 `renderMarketList` / `renderSourceList` 统一产出，Task 7 的兜底稿直接复用这两个函数——两份各自实现的格式化逻辑迟早会漂移。

- [ ] **Step 1: 写失败的测试**

`src/lib/briefing/render.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/render.test.ts`
Expected: FAIL，找不到模块 `./render`

- [ ] **Step 3: 扩展 sanitizer**

修改 `src/lib/sanitize-html.ts` 的 `sanitizeArticleHtml`。在既有 doc 注释后追加一段说明，并把配置改为：

```ts
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "b", "em", "i", "s", "u", "code", "pre",
      "blockquote", "ul", "ol", "li",
      // 每日早报必须标注新闻来源，因此放开链接。属性收得很紧：
      // 只允许 href/rel/target，协议限 http(s)（挡掉 javascript: 伪协议），
      // 且用 transformTags 强制覆写 rel/target——不信任正文里给出的属性值。
      "a",
    ],
    allowedAttributes: { a: ["href", "rel", "target"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: sanitizeHtml.simpleTransform(
        "a",
        { rel: "nofollow noopener noreferrer", target: "_blank" },
        true
      ),
    },
  });
}
```

- [ ] **Step 4: 实现 render.ts**

```ts
import type { BriefingJson, BriefingLocale, BriefingSource, MarketFact } from "./types";

export const DISCLAIMER: Record<BriefingLocale, string> = {
  "zh-CN":
    "本文由程序自动汇总公开信息生成，仅供参考，不构成投资建议。市场有风险，决策需自行判断。",
  "en-US":
    "This briefing is generated automatically from public sources for reference only and is not investment advice. Markets carry risk; make your own decisions.",
};

const COPY: Record<BriefingLocale, Record<string, string>> = {
  "zh-CN": {
    headlines: "24 小时要闻",
    analysis: "市场解读",
    snapshot: "行情快照",
    watchlist: "今日关注",
    sources: "信息来源",
  },
  "en-US": {
    headlines: "Last 24 Hours",
    analysis: "Market Read",
    snapshot: "Market Snapshot",
    watchlist: "On the Radar",
    sources: "Sources",
  },
};

/** 模型输出与源站标题都是不可信文本，一律转义后才拼进 HTML */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 导出供 fallback.ts 复用——两处行情列表的数字格式必须一致 */
export function formatPrice(n: number): string {
  // 低价币需要更多小数位，否则 DOGE 会显示成 $0.07
  const digits = n >= 1 ? 2 : 6;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** 导出供 fallback.ts 复用 */
export function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** 行情列表。正常稿与兜底稿共用，保证两种路径下的行情区块完全一致 */
export function renderMarketList(facts: MarketFact[]): string {
  return `<ul>${facts
    .map(
      (f) =>
        `<li><strong>${escapeHtml(f.label)}</strong> ${formatPrice(f.lastPrice)}（24h ${formatPct(
          f.change24hPct
        )}）</li>`
    )
    .join("")}</ul>`;
}

/** 来源列表。正常稿与兜底稿共用 */
export function renderSourceList(sources: BriefingSource[]): string {
  return `<ul>${sources
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a> — ${escapeHtml(s.source)}</li>`
    )
    .join("")}</ul>`;
}

export function renderBriefingHtml(
  b: BriefingJson,
  facts: MarketFact[],
  sources: BriefingSource[],
  locale: BriefingLocale
): string {
  const c = COPY[locale];
  const parts: string[] = [];

  parts.push(`<p><strong>${escapeHtml(b.summary)}</strong></p>`);

  parts.push(`<h2>${c.headlines}</h2>`);
  for (const h of b.headlines) {
    parts.push(`<h3>${escapeHtml(h.topic)}</h3>`);
    parts.push(`<ul>${h.points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`);
  }

  parts.push(`<h2>${c.analysis}</h2>`);
  parts.push(`<p>${escapeHtml(b.analysis.overview)}</p>`);
  parts.push(`<p>${escapeHtml(b.analysis.crypto)}</p>`);
  parts.push(`<p>${escapeHtml(b.analysis.gold)}</p>`);

  // 行情用列表而非表格：白名单的 allowedAttributes 是空的，表格拿不到 class、
  // 无法做响应式样式，而 ul/li 本就在白名单内且移动端更好读
  if (facts.length > 0) {
    parts.push(`<h3>${c.snapshot}</h3>`);
    parts.push(renderMarketList(facts));
  }

  if (b.analysis.watchlist.length > 0) {
    parts.push(`<h3>${c.watchlist}</h3>`);
    parts.push(
      `<ul>${b.analysis.watchlist.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
    );
  }

  if (sources.length > 0) {
    parts.push(`<h2>${c.sources}</h2>`);
    parts.push(renderSourceList(sources));
  }

  parts.push(`<hr>`);
  parts.push(`<p><em>${escapeHtml(DISCLAIMER[locale])}</em></p>`);

  return parts.join("\n");
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/render.test.ts`
Expected: PASS（12 个用例）

- [ ] **Step 6: 确认既有测试未回归**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/lib/briefing/render.ts src/lib/briefing/render.test.ts src/lib/sanitize-html.ts
git commit -m "feat(briefing): JSON→HTML 渲染；sanitizer 放开 <a> 以标注新闻来源"
```

---

## Task 7: 零 AI 兜底稿

**Files:**
- Create: `src/lib/briefing/fallback.ts`
- Test: `src/lib/briefing/fallback.test.ts`

**Interfaces:**
- Consumes: `escapeHtml`、`DISCLAIMER`、`renderMarketList`、`renderSourceList`（均自 Task 6 的 `render.ts`）；`BriefingSource`、`MarketFact`、`BriefingLocale`
- Produces:
  - `fallbackTitle(locale: BriefingLocale, dateStr: string): string`
  - `renderFallbackHtml(facts: MarketFact[], sources: BriefingSource[], locale: BriefingLocale): string`

> **参数顺序注意：** 与 `renderBriefingHtml(b, facts, sources, locale)` 保持一致，都是 **facts 在前、sources 在后**。两个渲染函数签名不一致是最容易埋 bug 的地方。

- [ ] **Step 1: 写失败的测试**

`src/lib/briefing/fallback.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/fallback.test.ts`
Expected: FAIL，找不到模块 `./fallback`

- [ ] **Step 3: 实现 fallback.ts**

```ts
import { DISCLAIMER, escapeHtml, renderMarketList, renderSourceList } from "./render";
import type { BriefingLocale, BriefingSource, MarketFact } from "./types";

/**
 * 零 AI 兜底稿。
 *
 * 不依赖 DeepSeek、不依赖任何模型：只把 24h 内的真实新闻标题与真实行情按固定
 * 模板拼起来。内容不含任何 AI 生成的判断，事实风险为零，因此直接发布——
 * 「今天这篇朴素了点」对每日栏目的伤害远小于「今天空一天」。
 */

const COPY: Record<BriefingLocale, { title: string; headlines: string; snapshot: string }> = {
  "zh-CN": { title: "24 小时要闻速览", headlines: "24 小时要闻", snapshot: "行情快照" },
  "en-US": { title: "24-Hour News Roundup", headlines: "Last 24 Hours", snapshot: "Market Snapshot" },
};

/** 单篇兜底稿最多列这么多条，再多读者也不会看 */
const MAX_ITEMS = 20;

export function fallbackTitle(locale: BriefingLocale, dateStr: string): string {
  return `${COPY[locale].title} | ${dateStr}`;
}

/**
 * 新闻与行情都为空时返回空串——调用方据此判定连兜底稿都出不了（L5）。
 * 参数顺序与 renderBriefingHtml 保持一致：facts 在前、sources 在后。
 */
export function renderFallbackHtml(
  facts: MarketFact[],
  sources: BriefingSource[],
  locale: BriefingLocale
): string {
  if (sources.length === 0 && facts.length === 0) return "";

  const c = COPY[locale];
  const parts: string[] = [];

  if (facts.length > 0) {
    parts.push(`<h2>${c.snapshot}</h2>`);
    parts.push(renderMarketList(facts));
  }

  if (sources.length > 0) {
    parts.push(`<h2>${c.headlines}</h2>`);
    parts.push(renderSourceList(sources.slice(0, MAX_ITEMS)));
  }

  parts.push(`<hr>`);
  parts.push(`<p><em>${escapeHtml(DISCLAIMER[locale])}</em></p>`);

  return parts.join("\n");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/fallback.test.ts`
Expected: PASS（11 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/briefing/fallback.ts src/lib/briefing/fallback.test.ts
git commit -m "feat(briefing): 零 AI 兜底稿——不依赖模型即可出稿"
```

---

## Task 8: DeepSeek 客户端、prompt 与翻译通道

**Files:**
- Create: `src/lib/briefing/prompt.ts`
- Create: `src/lib/briefing/deepseek.ts`
- Create: `src/lib/translate.ts`
- Modify: `src/app/api/admin/articles/translate/route.ts`
- Test: `src/lib/briefing/deepseek.test.ts`

**Interfaces:**
- Consumes: `BriefingSource`、`MarketFact`、`BriefingLocale`
- Produces:
  - `buildBriefingPrompt(sources: BriefingSource[], facts: MarketFact[], locale: BriefingLocale, dateStr: string): string`
  - `DeepSeekResult = { ok: true; content: string; finishReason: string | null } | { ok: false; error: string }`
  - `callDeepSeek(opts: { apiKey: string; model: string; prompt: string; maxTokens?: number; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<DeepSeekResult>`
  - `translateText(text: string, fromLang: string, toLang: string): Promise<string | null>`（`src/lib/translate.ts`）

- [ ] **Step 1: 抽取翻译通道**

新建 `src/lib/translate.ts`（实现自 `src/app/api/admin/articles/translate/route.ts` 原样搬移，逻辑一字未改）：

```ts
/**
 * Google Translate 免费端点。原先内嵌在后台文章翻译路由里，
 * 每日早报的降级阶梯 L3（两语中恰有一语生成失败时翻译另一语）也要用，
 * 故抽取共用。行为与原实现完全一致。
 */

/**
 * Google Translate free endpoint. Returns translated text or null on failure.
 * Handles newlines by temporarily replacing them so they survive translation.
 */
export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string | null> {
  // Protect newlines: replace \n with a marker Google Translate won't strip.
  // Using full-width brackets + "NL" – treated as a non-translatable token.
  const NL_MARKER = "［" + "NL" + "］"; // 【NL】using full-width brackets
  const prepared = text.replace(/\n/g, NL_MARKER);

  try {
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t` +
      `&q=${encodeURIComponent(prepared)}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();

    // Response format: [[["translated","original",...],...],...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((seg: unknown[]) =>
          seg && typeof seg[0] === "string" ? seg[0] : ""
        )
        .join("");

      if (translated) {
        // Restore newlines
        return translated.replace(new RegExp(NL_MARKER.replace(/[\[\]]/g, "\\$&"), "g"), "\n");
      }
    }

    return null;
  } catch {
    return null;
  }
}
```

然后把 `src/app/api/admin/articles/translate/route.ts` 里的本地 `translateText` 实现删除，改为顶部 `import { translateText } from "@/lib/translate";`。该路由其余逻辑（`extractLang`、参数校验、`requireAdmin`）一律不动。

> **注意：** 该函数是为翻译**纯文本**写的。L3 用它翻译整段 HTML 时，标签会被一并送进翻译接口——属于降级路径的已知妥协，可接受（总好过 `en-US` 为空导致英文与马来文读者看到空白正文）。译文仍会经 `sanitizeArticleHtml` 过一道。

- [ ] **Step 2: 验证抽取未破坏既有路由**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: 写失败的 DeepSeek 客户端测试**

`src/lib/briefing/deepseek.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { callDeepSeek } from "./deepseek";
import { buildBriefingPrompt } from "./prompt";
import type { BriefingSource, MarketFact } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OK_BODY = {
  choices: [{ message: { content: '{"title":"t"}' }, finish_reason: "stop" }],
};
// DeepSeek 文档明示会偶发空内容
const EMPTY_BODY = {
  choices: [{ message: { content: "" }, finish_reason: "stop" }],
};
const TRUNCATED_BODY = {
  choices: [{ message: { content: '{"title":"t' }, finish_reason: "length" }],
};

const BASE = { apiKey: "k", model: "deepseek-v4-flash", prompt: "p" };

describe("callDeepSeek", () => {
  it("正常响应返回内容与 finish_reason", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, content: '{"title":"t"}', finishReason: "stop" });
  });

  it("请求体带 json 模式与模型名", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("Authorization 头带 Bearer key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
  });

  it("空内容判为失败，交由调用方重试", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(EMPTY_BODY));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
  });

  it("截断响应仍返回内容，但 finishReason 为 length（交给质量门槛判定）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(TRUNCATED_BODY));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, finishReason: "length" });
  });

  it("HTTP 非 2xx 判为失败并带状态码", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 429));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("429");
  });

  it("网络异常不抛出，返回失败结果", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("boom");
  });

  it("choices 为空判为失败", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ choices: [] }));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
  });
});

describe("buildBriefingPrompt", () => {
  const sources: BriefingSource[] = [
    { title: "Gold record", url: "https://e.com/a", source: "Investing.com", publishedAt: 1, summary: "s" },
  ];
  const facts: MarketFact[] = [
    { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  ];

  it("含 json 一词（DeepSeek JSON 模式的硬性要求）", () => {
    expect(buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08").toLowerCase()).toContain("json");
  });

  it("注入真实行情事实", () => {
    const p = buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08");
    expect(p).toContain("64959.52");
    expect(p).toContain("0.92");
  });

  it("注入新闻标题", () => {
    expect(buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08")).toContain("Gold record");
  });

  it("含禁止编造数字的约束", () => {
    expect(buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08")).toContain("不得");
  });

  it("英文 locale 要求以英文作答", () => {
    expect(buildBriefingPrompt(sources, facts, "en-US", "2026-08-08")).toContain("English");
  });

  it("行情为空时明确告知无行情数据，避免模型硬写", () => {
    const p = buildBriefingPrompt(sources, [], "zh-CN", "2026-08-08");
    expect(p).toContain("无行情数据");
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run src/lib/briefing/deepseek.test.ts`
Expected: FAIL，找不到模块 `./deepseek`

- [ ] **Step 5: 实现 prompt.ts**

```ts
import type { BriefingLocale, BriefingSource, MarketFact } from "./types";

/** 单次 prompt 最多塞这么多条新闻，控制输入 token */
const MAX_SOURCES_IN_PROMPT = 40;

const LANG_INSTRUCTION: Record<BriefingLocale, string> = {
  "zh-CN": "全文使用简体中文作答，不要夹杂英文句子。",
  "en-US": "Write the entire response in English. Do not include Chinese sentences.",
};

/**
 * 构造早报 prompt。
 *
 * 两条硬约束是这个功能能不能用的关键：
 * 1. 数字只能引用下面注入的行情事实——AI 写金融内容最常见的翻车就是编价格，
 *    而质量门槛会拿同一份事实集机械核对 analysis 段落里的每个数字。
 * 2. 不得给出具体买卖点位或仓位建议。
 *
 * DeepSeek 的 JSON 模式要求 prompt 中出现 "json" 一词并给出格式示例，
 * 下面的输出格式段同时满足这两点。
 */
export function buildBriefingPrompt(
  sources: BriefingSource[],
  facts: MarketFact[],
  locale: BriefingLocale,
  dateStr: string
): string {
  const newsBlock = sources
    .slice(0, MAX_SOURCES_IN_PROMPT)
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title}${s.summary ? ` — ${s.summary}` : ""}`)
    .join("\n");

  const factsBlock =
    facts.length > 0
      ? facts
          .map((f) => `${f.label}: 最新价 ${f.lastPrice}，24小时涨跌 ${f.change24hPct}%`)
          .join("\n")
      : "（今日无行情数据，正文中不得出现任何价格或涨跌幅数字）";

  return `你是一名严谨的金融市场编辑，正在为 ${dateStr} 撰写每日市场早报。

${LANG_INSTRUCTION[locale]}

## 素材：过去 24 小时的新闻
${newsBlock}

## 事实：真实行情数据（唯一可引用的数字来源）
${factsBlock}

## 硬性约束
- 正文中出现的所有价格与涨跌幅，**只能**引用上面「事实」段落给出的数值，不得自行推断、回忆或估算任何数字。
- 引用价格时必须写成带美元符号与千分位的形式，例如 $64,959.52。
- **不得**给出具体买卖点位、目标价、止损位或仓位建议。
- **不得**使用「必涨」「稳赚」这类确定性表述。
- 提到黄金时，须说明数据来自黄金代币（XAUT / PAXG），不得表述为伦敦金或 COMEX 黄金期货报价。
- 分析要基于素材做出解读，而不是复述标题。

## 输出格式
只输出一个 json 对象，不要输出任何其他文字。格式示例：

{
  "title": "早报 | 8月8日 比特币小幅上行，黄金续创新高",
  "summary": "一句话导读，20 到 120 字",
  "headlines": [
    { "topic": "加密货币", "points": ["要点一", "要点二"] },
    { "topic": "黄金与大宗", "points": ["要点一"] },
    { "topic": "宏观金融", "points": ["要点一"] }
  ],
  "analysis": {
    "overview": "整体市场解读，80 到 600 字",
    "crypto": "加密市场解读，80 到 600 字",
    "gold": "黄金与大宗解读，80 到 600 字",
    "watchlist": ["今日关注的第一件事", "第二件事"]
  }
}

标题长度须在 10 到 60 字之间。headlines 至少包含 2 个主题。`;
}
```

- [ ] **Step 6: 实现 deepseek.ts**

```ts
/**
 * DeepSeek 客户端（OpenAI 兼容格式）。
 *
 * 模型名不硬编码：2026-08 官方模型线已换代为 deepseek-v4-flash / v4-pro，
 * deepseek-chat 与 deepseek-reasoner 已不在文档中，且官方公告称近期将上调价格。
 * 模型由调用方从环境变量传入，换代时改一个环境变量即可。
 *
 * 空内容是 DeepSeek 文档明示的已知问题（"The API may occasionally return
 * empty content"），这里归一成失败结果，由调用方重试或换模型。
 */

const API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MAX_TOKENS = 3000;
const DEFAULT_TIMEOUT_MS = 45_000;

export type DeepSeekResult =
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; error: string };

export async function callDeepSeek(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** 注入 fetch 便于测试 */
  fetchImpl?: typeof fetch;
}): Promise<DeepSeekResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await doFetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: opts.prompt }],
        response_format: { type: "json_object" },
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";

    if (!content.trim()) {
      return { ok: false, error: "DeepSeek 返回空内容" };
    }

    return { ok: true, content, finishReason: choice?.finish_reason ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run src/lib/briefing/deepseek.test.ts`
Expected: PASS（14 个用例）

- [ ] **Step 8: 提交**

```bash
git add src/lib/briefing/prompt.ts src/lib/briefing/deepseek.ts src/lib/briefing/deepseek.test.ts src/lib/translate.ts src/app/api/admin/articles/translate/route.ts
git commit -m "feat(briefing): DeepSeek 客户端与 prompt；抽取翻译通道供降级阶梯复用"
```

---

## Task 9: 数据库迁移

**Files:**
- Create: `supabase/migrations/041_daily_briefing.sql`

**Interfaces:**
- Consumes: 无
- Produces: `article_categories` 中 slug 为 `daily-briefing` 的分类；`admin_settings` 中 key 为 `daily_briefing_push_enabled` 的配置

- [ ] **Step 1: 写迁移文件**

```sql
-- Chart-IX 数据库迁移 #041: 每日 AI 市场早报
--
-- 注意：不要往 feature_flags 写任何东西——该表已在 038 迁移中删除
-- （007_articles.sql 里那句 INSERT INTO feature_flags 是历史遗留）。

-- ── 早报独立分类 ──────────────────────────────────────────
-- 每天一篇，塞进现有「市场分析」会把手写文章淹掉；
-- 独立分类同时天然成为早报归档页。sort_order 取 0 排在最前。
INSERT INTO public.article_categories (name, slug, sort_order) VALUES
  ('{"en-US":"Daily Briefing","zh-CN":"每日早报","ms-MY":"Taklimat Harian"}', 'daily-briefing', 0)
ON CONFLICT (slug) DO NOTHING;

-- ── 早报推送开关 ──────────────────────────────────────────
-- 默认关闭：每天一条推送对用户是打扰，先观察若干天内容质量再手动打开。
-- admin_settings 是通用键值表（key TEXT UNIQUE + value JSONB，见 004）。
INSERT INTO public.admin_settings (key, value, description) VALUES
  ('daily_briefing_push_enabled', 'false'::jsonb, '每日早报发布后是否推送通知')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: 在 Supabase SQL Editor 执行该迁移**

把文件内容整段粘贴执行。

- [ ] **Step 3: 验证两条记录都已写入**

```sql
SELECT id, slug, name FROM public.article_categories WHERE slug = 'daily-briefing';
SELECT key, value FROM public.admin_settings WHERE key = 'daily_briefing_push_enabled';
```

Expected: 各返回 1 行。**记下分类的 `id`**，下一个任务的路由要用它（通过 slug 查询，不要硬编码 id）。

- [ ] **Step 4: 提交**

```bash
git add supabase/migrations/041_daily_briefing.sql
git commit -m "feat(db): 041 每日早报分类与推送开关"
```

---

## Task 10: 告警与流水线主体

**流水线主体必须放在 `src/lib/`，不能放在 route 文件里。** Next.js App Router 会校验 route 文件的导出：只允许 HTTP 方法处理器与 `dynamic` / `maxDuration` 等少数配置项。多导出一个 `runDailyBriefing` 会导致构建报错 `Route ... does not match the required types of a Next.js Route`。Task 11 的后台手动触发要复用同一条流水线，因此它必须住在 lib 里。

**Files:**
- Create: `src/lib/briefing/alert.ts`
- Create: `src/lib/briefing/run.ts`
- Create: `src/app/api/cron/daily-briefing/route.ts`

**Interfaces:**
- Consumes: 全部前序任务的导出；`getTelegramPushSettings`（`@/lib/telegram-push`）、`sendTelegramMessage`（`@/lib/telegram-send`）
- Produces:
  - `alertBriefing(message: string): Promise<void>`
  - `runDailyBriefing(nowMs: number): Promise<BriefingRunResult>`（**永不抛出**，异常一律归一成 `failed`）
  - `BriefingRunResult = { status: "published" | "fallback" | "skipped" | "failed"; slug: string; detail?: string }`
  - `GET /api/cron/daily-briefing`

- [ ] **Step 1: 实现 alert.ts**

```ts
import * as Sentry from "@sentry/nextjs";
import { getTelegramPushSettings } from "@/lib/telegram-push";
import { sendTelegramMessage } from "@/lib/telegram-send";

/**
 * 早报降级/失败告警。
 *
 * 静默降级比报错糟糕得多——cron_heartbeats 的注释里记着同一个教训：
 * 「用户以为提醒开着，实际早死了」。任何降级都必须有人知道。
 *
 * Telegram 是可选的：只有配置了 BRIEFING_ALERT_CHAT_ID 才发。刻意**不**复用
 * telegram_push_targets——那些是推给用户的频道，把内部告警发过去是骚扰。
 */
export async function alertBriefing(message: string): Promise<void> {
  console.error(`[daily-briefing] ${message}`);
  Sentry.captureMessage(`daily-briefing: ${message}`, "warning");

  const chatId = process.env.BRIEFING_ALERT_CHAT_ID;
  if (!chatId) return;

  try {
    const settings = await getTelegramPushSettings();
    if (!settings.botToken) return;
    await sendTelegramMessage(settings.botToken, chatId, `⚠️ 每日早报告警\n\n${message}`);
  } catch (err) {
    // 告警本身失败绝不能影响主流程
    console.error("[daily-briefing] telegram alert failed", err);
  }
}
```

- [ ] **Step 2: 实现 run.ts（流水线主体）**

```ts
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildContentMessage } from "@/lib/push/messages";
import { translateText } from "@/lib/translate";
import { briefingSlug, utcPlus8DateString } from "@/lib/briefing/date";
import { fetchBriefingSources, MIN_SOURCE_ITEMS } from "@/lib/briefing/sources";
import { fetchMarketFacts } from "@/lib/briefing/market-facts";
import { buildBriefingPrompt } from "@/lib/briefing/prompt";
import { callDeepSeek } from "@/lib/briefing/deepseek";
import { checkBriefing, parseBriefingJson } from "@/lib/briefing/quality-gate";
import { renderBriefingHtml } from "@/lib/briefing/render";
import { fallbackTitle, renderFallbackHtml } from "@/lib/briefing/fallback";
import { alertBriefing as alert } from "@/lib/briefing/alert";
import type { BriefingJson, BriefingLocale, BriefingSource, MarketFact } from "@/lib/briefing/types";

const JOB_NAME = "daily-briefing";
const LOCALES: BriefingLocale[] = ["zh-CN", "en-US"];

export interface BriefingRunResult {
  status: "published" | "fallback" | "skipped" | "failed";
  slug: string;
  detail?: string;
}

/** 心跳：让「没有文章」可以和「任务根本没跑」区分开 */
async function beat(status: "ok" | "error" | "skipped") {
  try {
    await createServiceRoleClient()
      .from("cron_heartbeats")
      .upsert(
        { job_name: JOB_NAME, last_run_at: new Date().toISOString(), last_status: status },
        { onConflict: "job_name" }
      );
  } catch (err) {
    console.error("[daily-briefing] heartbeat failed", err);
  }
}

/** 生成一语。失败或不过门槛时换备用模型再试一次（降级阶梯 L1/L2） */
async function generateOne(
  locale: BriefingLocale,
  sources: BriefingSource[],
  facts: MarketFact[],
  dateStr: string
): Promise<BriefingJson | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY!;
  const prompt = buildBriefingPrompt(sources, facts, locale, dateStr);
  const models = [
    process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    process.env.DEEPSEEK_MODEL || "deepseek-v4-flash", // L1: 同模型重试一次（空内容是已知偶发问题）
    process.env.DEEPSEEK_FALLBACK_MODEL || "deepseek-v4-pro", // L2: 换模型
  ];

  for (const [attempt, model] of models.entries()) {
    const res = await callDeepSeek({ apiKey, model, prompt });
    if (!res.ok) {
      await alert(`${locale} 第 ${attempt + 1} 次调用失败(${model}): ${res.error}`);
      continue;
    }
    const parsed = parseBriefingJson(res.content);
    const gate = checkBriefing({
      json: parsed,
      facts,
      sources,
      locale,
      finishReason: res.finishReason,
    });
    if (gate.ok && parsed) return parsed;
    await alert(
      `${locale} 第 ${attempt + 1} 次未过质量门槛(${model}): ` +
        gate.failures.map((f) => `${f.rule}/${f.detail}`).join("; ")
    );
  }
  return null;
}

async function runPipeline(nowMs: number): Promise<BriefingRunResult> {
  const dateStr = utcPlus8DateString(nowMs);
  const slug = briefingSlug(dateStr);
  const supabase = createServiceRoleClient();

  const authorId = process.env.BRIEFING_AUTHOR_ID;
  if (!process.env.DEEPSEEK_API_KEY || !authorId) {
    await alert("缺少 DEEPSEEK_API_KEY 或 BRIEFING_AUTHOR_ID 环境变量");
    await beat("error");
    return { status: "failed", slug, detail: "missing env" };
  }

  // ① 幂等闸门。真正的并发保护是 articles.slug 的 UNIQUE 约束（见 ⑤），
  //    这次查询只是为了让重复 tick 便宜地早退。
  const { data: existing } = await supabase
    .from("articles")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    await beat("skipped");
    return { status: "skipped", slug };
  }

  // ② 取素材。任一路失败都不该拖垮另一路
  const [sourcesSettled, factsSettled] = await Promise.allSettled([
    fetchBriefingSources(nowMs),
    fetchMarketFacts(),
  ]);
  const sources = sourcesSettled.status === "fulfilled" ? sourcesSettled.value : [];
  const facts = factsSettled.status === "fulfilled" ? factsSettled.value : [];

  // L5：连兜底稿都出不了
  if (sources.length === 0 && facts.length === 0) {
    await alert("新闻与行情全部获取失败，今日无法出稿");
    await beat("error");
    return { status: "failed", slug, detail: "no material" };
  }

  // ③④ 素材充足才调用模型；否则直接兜底
  const title: Record<string, string> = {};
  const content: Record<string, string> = {};
  let degraded = sources.length < MIN_SOURCE_ITEMS;

  if (degraded) {
    await alert(`24h 内仅 ${sources.length} 条新闻，低于 ${MIN_SOURCE_ITEMS}，直接走兜底稿`);
  } else {
    const [zh, en] = await Promise.all([
      generateOne("zh-CN", sources, facts, dateStr),
      generateOne("en-US", sources, facts, dateStr),
    ]);

    if (zh && en) {
      title["zh-CN"] = zh.title;
      title["en-US"] = en.title;
      content["zh-CN"] = renderBriefingHtml(zh, facts, sources, "zh-CN");
      content["en-US"] = renderBriefingHtml(en, facts, sources, "en-US");
    } else if (zh || en) {
      // L3：两语中恰有一语成功，另一语走翻译通道。
      // en-US 缺失会让英文与马来文读者看到空白正文，绝不能留空。
      const okLocale: BriefingLocale = zh ? "zh-CN" : "en-US";
      const badLocale: BriefingLocale = zh ? "en-US" : "zh-CN";
      const good = (zh ?? en)!;
      const goodHtml = renderBriefingHtml(good, facts, sources, okLocale);
      const from = okLocale === "zh-CN" ? "zh" : "en";
      const to = badLocale === "zh-CN" ? "zh" : "en";

      title[okLocale] = good.title;
      content[okLocale] = goodHtml;
      title[badLocale] = (await translateText(good.title, from, to)) ?? good.title;
      content[badLocale] = (await translateText(goodHtml, from, to)) ?? goodHtml;
      await alert(`${badLocale} 生成失败，已用翻译通道兜住`);
    } else {
      degraded = true;
      await alert("中英两语均未通过质量门槛，改发零 AI 兜底稿");
    }
  }

  // L4：零 AI 兜底稿
  if (degraded) {
    for (const locale of LOCALES) {
      const html = renderFallbackHtml(facts, sources, locale);
      if (!html) {
        await beat("error");
        return { status: "failed", slug, detail: "fallback empty" };
      }
      title[locale] = fallbackTitle(locale, dateStr);
      content[locale] = html;
    }
  }

  // ⑤ 落库。分类按 slug 查，不硬编码 id
  const { data: category } = await supabase
    .from("article_categories")
    .select("id")
    .eq("slug", "daily-briefing")
    .maybeSingle();

  const { error: insertError } = await supabase.from("articles").insert({
    slug,
    title,
    content,
    category_id: category?.id ?? null,
    author_id: authorId,
    tier_required: "free",
    is_published: true,
    published_at: new Date().toISOString(),
  });

  if (insertError) {
    // 唯一约束冲突 = 另一个 tick 抢先写入了，这不是错误
    if (insertError.code === "23505") {
      await beat("skipped");
      return { status: "skipped", slug };
    }
    await alert(`落库失败: ${insertError.message}`);
    await beat("error");
    return { status: "failed", slug, detail: insertError.message };
  }

  // ⑥ 推送（默认关闭）
  try {
    const { data: setting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "daily_briefing_push_enabled")
      .maybeSingle();
    if (setting?.value === true) {
      const subs = await getOptedInSubscriptions("new_content");
      for (const sub of subs) {
        const locale = sub.locale === "zh-CN" ? "zh-CN" : "en-US";
        const msg = buildContentMessage(locale, "article", title[locale]);
        await sendToSubscriptions([sub], {
          title: msg.title,
          body: msg.body,
          url: `/${sub.locale}/articles/${slug}`,
          tag: JOB_NAME,
        });
      }
    }
  } catch (err) {
    // 推送失败不该让已经发布成功的文章被判为失败
    console.error("[cron/daily-briefing] push failed", err);
  }

  await beat("ok");
  return { status: degraded ? "fallback" : "published", slug };
}

/**
 * 对外入口。**永不抛出**——异常一律归一成 failed 结果。
 * 两个调用方（cron 路由与后台手动触发）因此都不必各写一遍 try/catch，
 * 且任何意外路径都保证留下心跳与告警。
 */
export async function runDailyBriefing(nowMs: number): Promise<BriefingRunResult> {
  try {
    return await runPipeline(nowMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { scope: "daily-briefing" } });
    await alert(`流水线异常: ${message}`);
    await beat("error");
    return { status: "failed", slug: briefingSlug(utcPlus8DateString(nowMs)), detail: message };
  }
}
```

- [ ] **Step 3: 实现 cron 路由（薄壳）**

`src/app/api/cron/daily-briefing/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 由 GitHub Actions 在 UTC+8 早 08:00–10:30 时间窗内每 30 分钟打一次。
 * 是否真的出稿由 runDailyBriefing 的幂等闸门决定，打得再频繁也只会出一篇。
 *
 * 本文件只做鉴权与转发——流水线主体在 @/lib/briefing/run，因为 Next.js
 * 不允许 route 文件导出 HTTP 处理器以外的东西，而后台手动触发要复用它。
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeCronTick(request.headers.get("authorization"), "daily-briefing");
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(auth.retryAfterMs / 1000)) } }
    );
  }

  const result = await runDailyBriefing(Date.now());
  return NextResponse.json({ success: result.status !== "failed", ...result });
}
```

- [ ] **Step 4: 确认类型检查通过**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5: 本地冒烟测试**

先在 `.env.local` 填好 `DEEPSEEK_API_KEY` 与 `BRIEFING_AUTHOR_ID`，然后：

```bash
npm run dev
```

另开一个终端：

```bash
curl -s "http://localhost:3000/api/cron/daily-briefing" | head -40
```

Expected: 返回 `{"success":true,"status":"published","slug":"daily-briefing-YYYY-MM-DD"}`。再打一次应返回 `"status":"skipped"`——这验证了幂等闸门。

- [ ] **Step 6: 人工检查生成的文章质量**

打开 `http://localhost:3000/zh-CN/articles/daily-briefing-<今天日期>`，确认：正文结构完整、行情数字与 `https://open-api.bingx.com/openApi/spot/v1/ticker/24hr` 的实际值一致、来源链接可点击、免责声明在底部。再打开 `/en-US/...` 确认英文版不是空白。

- [ ] **Step 7: 提交**

```bash
git add src/lib/briefing/alert.ts src/lib/briefing/run.ts src/app/api/cron/daily-briefing/route.ts
git commit -m "feat(briefing): 流水线主体与 cron 入口——幂等闸门、降级阶梯、落库与告警"
```

---

## Task 11: 后台手动触发

**Files:**
- Create: `src/app/api/admin/briefing/run-now/route.ts`

**Interfaces:**
- Consumes: `runDailyBriefing`（`@/lib/briefing/run`，Task 10）；`requireAdmin`
- Produces: `POST /api/admin/briefing/run-now`

- [ ] **Step 1: 实现路由**

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 后台「立即生成早报」。沿用 telegram-push/push-now 的模式：复用同一条流水线，
 * 只是把触发方式从 cron tick 换成管理员点击。调试与补发都依赖它。
 *
 * 注意：流水线自带幂等闸门，今天已出过稿会返回 skipped。要重新生成需先在
 * 数据库删掉那篇文章。runDailyBriefing 永不抛出，故此处无需 try/catch。
 */
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const result = await runDailyBriefing(Date.now());
  return NextResponse.json({ success: result.status !== "failed", ...result });
}
```

- [ ] **Step 2: 确认类型检查通过**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: 验证鉴权确实生效**

未登录状态下：

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3000/api/admin/briefing/run-now"
```

Expected: `401`

- [ ] **Step 4: 提交**

```bash
git add src/app/api/admin/briefing/run-now/route.ts
git commit -m "feat(briefing): 后台立即生成早报入口"
```

---

## Task 12: 调度接入与环境变量

**Files:**
- Modify: `.github/workflows/cron-tick.yml`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `GET /api/cron/daily-briefing`（Task 10）
- Produces: 无

- [ ] **Step 1: 给 workflow 加早报 schedule 与 step**

把 `.github/workflows/cron-tick.yml` 的 `on.schedule` 改为两条：

```yaml
on:
  schedule:
    - cron: "*/10 * * * *"
    # 早报：UTC 00:00–02:30 每 30 分钟 = UTC+8 早 08:00–10:30，共 6 次机会。
    # 端点自带幂等闸门（articles.slug 唯一），只会成功产出一篇；某次 tick 撞上
    # DeepSeek 抽风或 60s 超时，半小时后自动重试，而不是整天开天窗。
    - cron: "0,30 0-2 * * *"
  workflow_dispatch: {}
```

并在 `jobs.tick.steps` 末尾追加：

```yaml
      - name: Daily briefing
        if: always()
        run: |
          auth=()
          [ -n "$CRON_TICK_TOKEN" ] && auth=(-H "Authorization: Bearer $CRON_TICK_TOKEN")
          code=$(curl -s -o /tmp/db.json -w "%{http_code}" --max-time 90 "${auth[@]}" \
            "https://chart-ix.vercel.app/api/cron/daily-briefing")
          echo "daily-briefing HTTP $code"
          cat /tmp/db.json
          [ "$code" -lt 500 ]
```

- [ ] **Step 2: 补环境变量示例**

在 `.env.local.example` 末尾追加：

```
# DeepSeek（每日 AI 市场早报）。key 在 https://platform.deepseek.com 签发。
# 模型名会换代：2026-08 官方线为 deepseek-v4-flash / deepseek-v4-pro，
# deepseek-chat 与 deepseek-reasoner 已下线。换代时只改这里，不改代码。
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_FALLBACK_MODEL=deepseek-v4-pro

# 早报文章的署名账号 UUID（articles.author_id 是 NOT NULL 且外键指向 auth.users）。
# 在后台 /admin/users 建一个「Chart-IX 编辑部」账号后，取其 id 填在这里。
BRIEFING_AUTHOR_ID=

# 可选：早报降级/失败时把告警发到这个 Telegram chat（复用后台已配置的 bot token）。
# 留空则只记 Sentry 与服务端日志。刻意不复用 telegram_push_targets——
# 那些是推给用户的频道，内部告警发过去是骚扰。
BRIEFING_ALERT_CHAT_ID=
```

- [ ] **Step 3: 在 Vercel 配置环境变量**

到 Vercel 项目 Settings → Environment Variables，添加 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_FALLBACK_MODEL`、`BRIEFING_AUTHOR_ID`，作用域勾选 Production。`BRIEFING_ALERT_CHAT_ID` 可选。**密钥只在这里配置，绝不进 workflow 文件——仓库是公开的。**

- [ ] **Step 4: 提交并推送**

```bash
git add .github/workflows/cron-tick.yml .env.local.example
git commit -m "ci(briefing): UTC+8 早 8 点时间窗内幂等 tick；补环境变量示例"
git push
```

- [ ] **Step 5: 端到端验证**

到 GitHub Actions 手动触发一次 `cron-tick`，确认 `Daily briefing` step 返回 HTTP 200。然后：

```sql
SELECT slug, is_published, published_at FROM public.articles
WHERE slug LIKE 'daily-briefing-%' ORDER BY published_at DESC LIMIT 3;

SELECT job_name, last_run_at, last_status FROM public.cron_heartbeats
WHERE job_name = 'daily-briefing';
```

Expected: 有今天的文章记录且 `is_published = true`；心跳 `last_status` 为 `ok` 或 `skipped`。

- [ ] **Step 6: 次日复核**

第二天早上确认线上真的自动出了一篇新文章，且日期正确（UTC+8 日界）。这一步无法提前验证，必须实际等一天。

---

## 验收清单

- [ ] `npx vitest run` 全绿
- [ ] `npx tsc --noEmit` 无错误
- [ ] `/zh-CN/articles` 列表出现「每日早报」分类且有今天的文章
- [ ] 文章内行情数字与 BingX 现货 24h 接口实际值一致（抽查 BTC 与 XAUT）
- [ ] `/en-US/articles/daily-briefing-<日期>` 正文非空
- [ ] `/ms-MY/articles/daily-briefing-<日期>` 显示英文版而非空白
- [ ] 来源链接可点击且带 `rel="nofollow noopener noreferrer"`
- [ ] 文章底部有免责声明
- [ ] 重复请求 cron 端点返回 `skipped`，不产生第二篇
- [ ] `cron_heartbeats` 中 `daily-briefing` 有新鲜时间戳
