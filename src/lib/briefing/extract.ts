import { decodeEntities, stripHtml } from "@/lib/rss";
import type { BriefingSource } from "./types";

/**
 * 抓取新闻正文。
 *
 * 存在的理由：RSS 只给标题和一两句摘要，模型据此只能写出"复述标题"级别的
 * 内容——读者看到的就是一堆似曾相识的空话。要写出真正的提炼，模型得读到
 * 报道本身在说什么。
 *
 * 只抓最近的一批（MAX_BODIES）而不是全部：正文是输入 token 的大头，而越靠前
 * 的新闻越新、越可能是当天的主线；后面那些留着标题参与「要闻」板块就够了。
 */

/** 抓取正文的新闻条数上限 */
export const MAX_BODIES = 12;

/** 单篇正文截断长度。够模型看懂在讲什么，又不至于把输入撑爆 */
export const BODY_MAX_CHARS = 700;

/** 单篇抓取超时。抓不到就退回只用标题，绝不为了一篇正文拖垮整条流水线 */
const FETCH_TIMEOUT_MS = 6_000;

/** 短于这个长度的段落多半是导航、版权、订阅提示，不是正文 */
const MIN_PARAGRAPH_CHARS = 40;

export interface SourceWithBody extends BriefingSource {
  /** 抓到的正文；抓不到或抓到的内容不可用时为空串 */
  body: string;
}

/**
 * 从 HTML 里抠出正文。
 *
 * 用 <p> 段落而不是整页去标签：新闻站的导航、页脚、推荐位里有大量短文本，
 * 整页剥标签会把它们和正文混在一起，模型读到的一半是"订阅我们的新闻通讯"。
 * 按段落取、并丢掉过短的段落，是不引入依赖的前提下最稳的一档启发式。
 */
export function extractArticleText(html: string, maxChars = BODY_MAX_CHARS): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const paragraphs: string[] = [];
  for (const m of withoutNoise.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities(stripHtml(m[1])).replace(/\s+/g, " ").trim();
    if (text.length >= MIN_PARAGRAPH_CHARS) paragraphs.push(text);
    if (paragraphs.join(" ").length >= maxChars) break;
  }

  return paragraphs.join(" ").slice(0, maxChars);
}

async function fetchOne(source: BriefingSource): Promise<SourceWithBody> {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Chart-IX/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ...source, body: "" };
    const contentType = res.headers.get("content-type") ?? "";
    // 只解析 HTML：有的源站会对爬虫返回 PDF 或 JSON，硬解析只会得到乱码
    if (!contentType.includes("html")) return { ...source, body: "" };
    return { ...source, body: extractArticleText(await res.text()) };
  } catch {
    // 抓失败是常态（付费墙、反爬、超时），退回只用标题即可，不必告警
    return { ...source, body: "" };
  }
}

/**
 * 并发抓取前 MAX_BODIES 篇的正文，其余条目原样返回（body 为空串）。
 * 任何一篇失败都不影响其他篇，也不影响整条流水线。
 */
export async function fetchArticleBodies(
  sources: BriefingSource[]
): Promise<SourceWithBody[]> {
  const head = sources.slice(0, MAX_BODIES);
  const tail = sources.slice(MAX_BODIES);

  const settled = await Promise.allSettled(head.map(fetchOne));
  const withBodies = settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : { ...head[i], body: "" }
  );

  return [...withBodies, ...tail.map((s) => ({ ...s, body: "" }))];
}
