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
  },
  "en-US": {
    headlines: "Last 24 Hours",
    analysis: "Market Read",
    snapshot: "Market Snapshot",
    watchlist: "On the Radar",
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

  // 正常稿**不列信息来源**。
  //
  // 原本每篇末尾挂着几十条源站链接。上线后看实际效果，它有两个问题：一是读者
  // 要的是读完就懂的简报，一串外链只是噪音；二是源站标题全是英文，挂在中文
  // 正文后面就成了中英混排，观感很差。分析本身已经是对这些新闻的提炼，
  // 逐条列出反而削弱了它。
  //
  // 兜底稿是另一回事：那里的新闻标题**就是内容本体**（没有 AI 判断可给），
  // 所以 fallback.ts 仍然列出来。
  parts.push(`<hr>`);
  parts.push(`<p><em>${escapeHtml(DISCLAIMER[locale])}</em></p>`);

  return parts.join("\n");
}
