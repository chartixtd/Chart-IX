import { MAX_SOURCES_IN_PROMPT } from "./prompt";
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

/**
 * 行情列表。正常稿与兜底稿共用，保证两种路径下的行情区块完全一致。
 *
 * 必须按语言选括号：中文用全角（），英文用半角 ()。早报会出 en-US 版，
 * 把全角括号写死会让英文正文出现「$64,959.52（24h +0.92%）」这种中英混排。
 */
export function renderMarketList(facts: MarketFact[], locale: BriefingLocale): string {
  const [open, close] = locale === "zh-CN" ? ["（", "）"] : [" (", ")"];
  return `<ul>${facts
    .map(
      (f) =>
        `<li><strong>${escapeHtml(f.label)}</strong> ${formatPrice(f.lastPrice)}${open}24h ${formatPct(
          f.change24hPct
        )}${close}</li>`
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
    parts.push(renderMarketList(facts, locale));
  }

  if (b.analysis.watchlist.length > 0) {
    parts.push(`<h3>${c.watchlist}</h3>`);
    parts.push(
      `<ul>${b.analysis.watchlist.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
    );
  }

  // 来源按 MAX_SOURCES_IN_PROMPT 截断：sources.ts 允许每源 25 条 × 8 源，过完
  // 24h 过滤后最多 200 条能到这里，而 prompt 只喂了前 40 条。不截断的话每篇早报
  // 末尾会挂 100-150 条链接，其中绝大多数模型根本没读过——既是内容质量与 SEO
  // 问题（每天 100+ 外链），也和兜底稿自己写的「再多读者也不会看」相互矛盾。
  if (sources.length > 0) {
    parts.push(`<h2>${c.sources}</h2>`);
    parts.push(renderSourceList(sources.slice(0, MAX_SOURCES_IN_PROMPT)));
  }

  parts.push(`<hr>`);
  parts.push(`<p><em>${escapeHtml(DISCLAIMER[locale])}</em></p>`);

  return parts.join("\n");
}
