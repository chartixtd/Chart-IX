/**
 * 没填封面时，从正文里挑第一张图当封面。
 *
 * 文章列表、分享卡、OG 图都要封面；作者正文里明明配了图却因为没单独传封面
 * 而露出占位图，是很没道理的。这里只在封面为空时兜底，不覆盖已填的值。
 */

import type { Locale } from "@/types";

/** 与站内其余地方一致的语言顺序，避免依赖对象键的枚举顺序。 */
const LOCALE_ORDER: Locale[] = ["zh-CN", "en-US", "ms-MY"];

/**
 * 取 HTML 里第一个 <img> 的 src。
 *
 * 用正则而不是 DOMParser：这段逻辑要能在 node 环境的单测里跑，而且待解析的
 * HTML 来自本站编辑器、形状可控。只认 http(s)，把 data: 之类挡在封面字段外。
 */
export function firstImageSrc(html: string): string | null {
  const match = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  const src = match?.[1]?.trim();
  if (!src) return null;
  return /^https?:\/\//i.test(src) ? src : null;
}

/** 按固定语言顺序找出第一张可用的正文配图。 */
export function pickCoverFromContent(content: Record<string, string>): string | null {
  for (const locale of LOCALE_ORDER) {
    const html = content[locale];
    if (!html) continue;
    const src = firstImageSrc(html);
    if (src) return src;
  }
  return null;
}
