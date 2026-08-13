import { SITE_URL } from "@/lib/constants";
import {
  deliverToTargets,
  escapeHtml,
  getTelegramPushSettings,
  listTargetsFor,
  type TargetDeliveryResult,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import type { BriefingLocale } from "@/lib/briefing/types";

/**
 * 把当天早报的**文章网址**推到 Telegram（可指定话题）。
 *
 * 刻意复用 telegram_push_targets，而不是另起一套配置：目标表已经带着
 * 每目标的 bot token、语言、话题、健康状态与投递日志，再造一份只会出现
 * 「榜单发得出去、早报发不出去，但两边的报错各在一个地方」这种局面。
 * 一个目标订阅哪几种内容由 push_screener / push_briefing 两个开关决定，
 * 于是「早报发到哪个话题」在后台就是勾一个框。
 *
 * 与 pushScreenerToTelegram 的关键区别：**不碰 telegram_push_settings 上的
 * last_pushed_at**。那个时间戳是榜单推送间隔的判据，早报写它会把下一轮榜单
 * 推迟整整一个间隔。早报的调度由流水线自己的发布时间窗决定。
 */

/**
 * 早报推送跑在整条流水线的尾巴上，预算已经花得差不多了，所以传输参数比默认
 * 更紧：默认的 3 次尝试 × 10 秒超时最坏能耗掉 30 秒以上，而此时文章已经落库
 * 发布、心跳也写完了——为一条链接把函数拖到被平台掐断毫无意义。
 */
const BRIEFING_SEND_MAX_ATTEMPTS = 2;
const BRIEFING_SEND_TIMEOUT_MS = 4_000;

/** 上面这组参数的最坏耗时：4s + 500ms 退避 + 4s，向上取整留点余量。 */
export const BRIEFING_TELEGRAM_BUDGET_MS = 9_000;

export interface BriefingPushOutcome {
  /** 没投递时为什么跳过；正常投递时不存在 */
  skippedReason?: "disabled" | "no_targets" | "no_token";
  results: TargetDeliveryResult[];
}

/** 推送语言 → 文章 URL 用的 locale。早报只出这两种语言 */
function localeFor(lang: TelegramMessageLang): BriefingLocale {
  return lang === "zh" ? "zh-CN" : "en-US";
}

export function briefingArticleUrl(slug: string, lang: TelegramMessageLang): string {
  return `${SITE_URL}/${localeFor(lang)}/articles/${slug}`;
}

/**
 * 网址单独成行、**不包在 <a> 里**：这样它既是可见可复制的原文，Telegram 也会
 * 展开链接预览卡（deliverToTargets 为此把 disable_web_page_preview 关掉）。
 * 榜单推送是相反的取舍——那种消息里的链接只会挤占版面。
 */
export function formatBriefingMessage(
  lang: TelegramMessageLang,
  title: string,
  url: string
): string {
  const heading = lang === "zh" ? "每日早报" : "Daily Briefing";
  return [`📰 <b>${escapeHtml(heading)}</b>`, "", escapeHtml(title), "", url].join("\n");
}

/**
 * @param slug     文章 slug，用来拼各语言的 URL
 * @param titles   按 locale 的标题（就是落库时那个 title 对象）
 */
export async function pushBriefingToTelegram(
  slug: string,
  titles: Record<string, string>
): Promise<BriefingPushOutcome> {
  const [settings, targets] = await Promise.all([
    getTelegramPushSettings(),
    listTargetsFor("briefing"),
  ]);

  // 总开关同样管早报。它在后台就叫「启用推送」——关掉之后还有消息从同一个
  // Bot 发出去，是最不该出现的意外。想只发早报不发榜单，把目标的「筛选榜单」
  // 取消勾选即可，那才是按内容分流的正确开关。
  if (!settings.enabled) return { skippedReason: "disabled", results: [] };
  if (targets.length === 0) return { skippedReason: "no_targets", results: [] };
  if (!settings.botToken && targets.every((t) => !t.botToken)) {
    return { skippedReason: "no_token", results: [] };
  }

  const results = await deliverToTargets(
    settings,
    targets,
    (lang) => {
      const locale = localeFor(lang);
      // 兜底到另一语的标题：单语降级时（AI 中文 + 翻译失败）另一语仍然有稿，
      // 宁可推一条标题语言不对的链接，也不要推一条标题是 "undefined" 的。
      const title = titles[locale] ?? titles["zh-CN"] ?? titles["en-US"] ?? slug;
      return formatBriefingMessage(lang, title, briefingArticleUrl(slug, lang));
    },
    "briefing",
    {
      maxAttempts: BRIEFING_SEND_MAX_ATTEMPTS,
      timeoutMs: BRIEFING_SEND_TIMEOUT_MS,
      disableWebPagePreview: false,
    }
  );

  return { results };
}
