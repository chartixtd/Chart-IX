import { SITE_URL } from "@/lib/constants";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  deliverToTargets,
  escapeHtml,
  getTelegramPushSettings,
  listTargetsFor,
  type TargetDeliveryResult,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import { briefingSlug, utcPlus8DateString } from "@/lib/briefing/date";
import { alertBriefing } from "@/lib/briefing/alert";
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

// ---------------------------------------------------------------------------
// 投递状态与补投
// ---------------------------------------------------------------------------

/**
 * 「今天这条链接发出去了没」的唯一事实来源。
 *
 * 存在的理由是一次真实事故：早报流水线一天只被触发一次（vercel.json 的
 * `0 1 * * *`），于是链接投递也只有一次机会。那天生成偏慢，投递被预算门槛
 * 跳过——文章发了、链接没发，而且**没有任何机制会再试一次**，只能等人发现、
 * 手动补。
 *
 * 榜单推送早就没有这个毛病：cron 打得比推送间隔密得多，漏掉的一轮由下一轮
 * 自动补上（见 telegram-push.ts 的 isPushDue）。这里把同一条原则搬过来——
 * 记下「哪篇的链接已经发了」，让高频 tick 去补没发成的那些。
 */
const DELIVERY_STATE_KEY = "daily_briefing_telegram_delivery";

interface BriefingDeliveryState {
  slug: string;
  /** null = 还没发成功过 */
  deliveredAt: string | null;
  /** 已经试过几次。用来给补投封顶，见 MAX_RETRY_ATTEMPTS */
  attempts: number;
}

/**
 * 补投次数上限。
 *
 * 10 分钟一个 tick，6 次 = 一小时。够覆盖绝大多数瞬时故障（Telegram 抖动、
 * 冷启动超时、部署窗口），又不会在「话题被关闭」这类改不好就一直错的配置
 * 问题上，每 10 分钟往 telegram_push_log 里灌一条失败、把目标的连续失败数
 * 刷到三位数。次数耗尽会告警一次，剩下的交给后台那个手动推送按钮。
 */
const MAX_RETRY_ATTEMPTS = 6;

async function readDeliveryState(): Promise<BriefingDeliveryState | null> {
  const { data } = await createServiceRoleClient()
    .from("admin_settings")
    .select("value")
    .eq("key", DELIVERY_STATE_KEY)
    .maybeSingle();
  const v = data?.value as Partial<BriefingDeliveryState> | undefined;
  if (!v || typeof v.slug !== "string") return null;
  return {
    slug: v.slug,
    deliveredAt: typeof v.deliveredAt === "string" ? v.deliveredAt : null,
    attempts: typeof v.attempts === "number" ? v.attempts : 0,
  };
}

async function writeDeliveryState(state: BriefingDeliveryState): Promise<void> {
  await createServiceRoleClient().from("admin_settings").upsert(
    {
      key: DELIVERY_STATE_KEY,
      value: state,
      description: "每日早报链接的 Telegram 投递状态（程序自动写入）",
    },
    { onConflict: "key" }
  );
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
      // 用 || 而不是 ??：空字符串同样得往下兜，否则消息里会空出一行。
      const title = titles[locale] || titles["zh-CN"] || titles["en-US"] || slug;
      return formatBriefingMessage(lang, title, briefingArticleUrl(slug, lang));
    },
    "briefing",
    {
      maxAttempts: BRIEFING_SEND_MAX_ATTEMPTS,
      timeoutMs: BRIEFING_SEND_TIMEOUT_MS,
      disableWebPagePreview: false,
    }
  );

  // 记账放在这里，所有调用方（流水线、后台手动、补投）都自动受益：忘记记账
  // 的那个调用方会让补投一直重复发同一条链接。
  //
  // 「至少一个目标成功」就算发过了，与 pushScreenerToTelegram 的 delivered
  // 同一套语义。部分失败不再补投是刻意的：补投会给已经收到的那些目标再发
  // 一遍，而重复消息比某个频道少一条更烦人；那种情况有告警和后台的手动按钮。
  const delivered = results.some((r) => r.ok);
  try {
    const prev = await readDeliveryState();
    await writeDeliveryState({
      slug,
      deliveredAt: delivered ? new Date().toISOString() : null,
      attempts: (prev?.slug === slug ? prev.attempts : 0) + 1,
    });
  } catch (err) {
    // 记账失败不能把已经发出去的消息说成失败
    console.error("[daily-briefing] failed to record telegram delivery state", err);
  }

  return { results };
}

export interface BriefingRetryOutcome {
  /** 没做事时的原因，便于 cron 日志区分「没必要补」和「补了」 */
  skipped?:
    | "already_delivered"
    | "no_article_today"
    | "attempts_exhausted"
    | "not_configured";
  slug?: string;
  delivered?: boolean;
}

/**
 * 补投今天的早报链接——由高频 tick 调用（见 /api/cron/telegram-push）。
 *
 * 流水线一天只跑一次，所以它那次投递失败就是永久失败。这个函数把「漏掉的
 * 一轮由下一轮补上」这条本项目已有的原则，从榜单推送搬到早报链接上。
 *
 * 三重收敛条件，缺一不可：
 * 1. 只补**今天**那篇。否则首次部署时会把昨天的链接当新消息推出去。
 * 2. 已经发成功过就不再发。这是不重复的保证。
 * 3. 次数封顶。改不好的配置问题（比如话题被关闭）不该每 10 分钟重试到天荒地老。
 */
export async function retryUndeliveredBriefingLink(): Promise<BriefingRetryOutcome> {
  const todaySlug = briefingSlug(utcPlus8DateString(Date.now()));

  // 最便宜的检查放最前：正常情况下今天的链接早发完了，一次查询就能返回。
  const state = await readDeliveryState();
  if (state?.slug === todaySlug) {
    if (state.deliveredAt) return { skipped: "already_delivered", slug: todaySlug };
    if (state.attempts >= MAX_RETRY_ATTEMPTS) {
      return { skipped: "attempts_exhausted", slug: todaySlug };
    }
  }

  const { data } = await createServiceRoleClient()
    .from("articles")
    .select("slug, title")
    .eq("slug", todaySlug)
    .eq("is_published", true)
    .maybeSingle();

  // 今天还没出稿：不是要补投的场景，等流水线自己发。
  if (!data) return { skipped: "no_article_today" };

  const outcome = await pushBriefingToTelegram(todaySlug, (data.title ?? {}) as Record<string, string>);
  const delivered = outcome.results.some((r) => r.ok);

  // 配置类跳过（总开关关着、没目标、没 token）不该消耗补投次数，也不该告警——
  // 那是管理员的选择，不是故障。pushBriefingToTelegram 在这几条路径上不写
  // 记账，所以次数自然不动。
  if (outcome.skippedReason) return { skipped: "not_configured", slug: todaySlug };

  // 次数刚好耗尽且仍未成功：告警一次，之后彻底安静。静默放弃正是这套补投
  // 机制要终结的东西。
  if (!delivered && (state?.attempts ?? 0) + 1 >= MAX_RETRY_ATTEMPTS) {
    const detail = outcome.results
      .filter((r) => !r.ok)
      .map((r) => `${r.label}: ${r.error ?? "unknown"}`)
      .join("; ");
    await alertBriefing(`早报链接补投 ${MAX_RETRY_ATTEMPTS} 次仍未成功，已放弃：${detail}`);
  }

  return { slug: todaySlug, delivered };
}
