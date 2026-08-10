import { DISCLAIMER, escapeHtml, renderMarketList, renderSourceList } from "./render";
import { formatBriefingTitle } from "./title";
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

/**
 * 兜底稿的标题走**和正常稿完全相同**的格式化函数（见 title.ts）。
 *
 * 从前它自己拼成「24 小时要闻速览 | 2026-08-10」——既没有栏目名，日期还是 ISO
 * 格式，和前一天的「早报 | 8月9日 …」摆在列表页里像两个不同的栏目。而降级恰恰
 * 是最不该让读者察觉的时刻：内容朴素一点没关系，栏目不能看起来断了。
 */
export function fallbackTitle(locale: BriefingLocale, dateStr: string): string {
  return formatBriefingTitle(COPY[locale].title, dateStr, locale);
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
    parts.push(renderMarketList(facts, locale));
  }

  if (sources.length > 0) {
    parts.push(`<h2>${c.headlines}</h2>`);
    parts.push(renderSourceList(sources.slice(0, MAX_ITEMS)));
  }

  parts.push(`<hr>`);
  parts.push(`<p><em>${escapeHtml(DISCLAIMER[locale])}</em></p>`);

  return parts.join("\n");
}
