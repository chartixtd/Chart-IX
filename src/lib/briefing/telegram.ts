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
import { isFinal, readPublishState } from "@/lib/briefing/publish-state";
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
// 投递记账：一天一行，靠唯一约束保证「只发一次」
// ---------------------------------------------------------------------------

/**
 * 「今天这条链接发出去了没」的唯一事实来源。
 *
 * 存在的理由是一次真实事故：早报流水线一天只被触发一次，于是链接投递也只有
 * 一次机会。那天生成偏慢，投递被预算门槛跳过——文章发了、链接没发，而且没有
 * 任何机制会再试一次。补投机制就是为此而生。
 *
 * 但补投的第一版把「发过没有」记在**一行可变 JSON** 里（就是下面那个
 * LEGACY_DELIVERY_KEY），每个 tick 先读它、再决定发不发。线上的结果是频道里
 * 一天收到十几条同一条链接：读这行的查询只要失败一次，判据就从「今天发过了」
 * 塌成「没有记录」，于是又发一条——闸门建立在「读得到旧值」之上，读不到就整个
 * 失效。而读失败在 serverless 上不是稀有事件（10 分钟一跳，几乎每跳都是冷
 * 启动），实测一天里有 7% 左右的 tick 就这么漏了过去。
 *
 * 现在改成**一天一行**，key 带上 slug，由 admin_settings.key 上的唯一约束
 * 来挡重复：发之前先 INSERT 认领这一天，冲突（23505）就说明别人已经认领过。
 * 于是「发没发过」不再是某次查询的结果，而是数据库约束的结果；查询出错时认领
 * 拿不到，我们就**不发**——少发一轮下个 tick 还能补，多发一条永远收不回来。
 */
const DELIVERY_KEY_PREFIX = "daily_briefing_telegram_delivery:";

/** 改成一天一行之前的那个单行状态键。只读、只为接住改动上线当天那一篇。 */
const LEGACY_DELIVERY_KEY = "daily_briefing_telegram_delivery";

const DELIVERY_DESCRIPTION = "每日早报链接的 Telegram 投递记录（程序自动写入，次日自动清理）";

function deliveryKey(slug: string): string {
  return `${DELIVERY_KEY_PREFIX}${slug}`;
}

interface BriefingDeliveryRecord {
  slug: string;
  /** null = 还没发成功过 */
  deliveredAt: string | null;
  /** 已经认领过几次投递。封顶见 MAX_RETRY_ATTEMPTS */
  attempts: number;
  /** 最后一次认领的时刻，用来判断「是不是有另一个 tick 正发到一半」 */
  claimedAt: string;
}

/**
 * 补投次数上限。
 *
 * 10 分钟一个 tick，6 次 = 一小时。够覆盖绝大多数瞬时故障（Telegram 抖动、
 * 冷启动超时、部署窗口），又不会在「话题被关闭」这类改不好就一直错的配置
 * 问题上，每 10 分钟往 telegram_push_log 里灌一条失败、把目标的连续失败数
 * 刷到三位数。次数耗尽会告警一次，剩下的交给后台那个手动推送按钮。
 *
 * 它同时是重复推送的最后一道封顶：次数记在认领那一刻（发之前），而那一行
 * 一天只可能被创建一次，所以即使记账整天都写不进去，一天最多也就 6 条，
 * 不会再有十几条。
 */
const MAX_RETRY_ATTEMPTS = 6;

/**
 * 认领的租期。认领之后、记账之前函数被平台掐断，这一行会停在「已认领、未
 * 投递」上；租期过了才允许下一个 tick 接手。取 2 分钟：一轮投递最坏 9 秒
 * （BRIEFING_TELEGRAM_BUDGET_MS），留足冷启动与网络抖动的余量，而 tick 是
 * 10 分钟一次，租期无论如何都在下一跳之前到期。
 */
const CLAIM_LEASE_MS = 120_000;

function parseDeliveryRecord(value: unknown): BriefingDeliveryRecord | null {
  const v = value as Partial<BriefingDeliveryRecord> | null | undefined;
  if (!v || typeof v.slug !== "string") return null;
  return {
    slug: v.slug,
    deliveredAt: typeof v.deliveredAt === "string" ? v.deliveredAt : null,
    attempts: typeof v.attempts === "number" ? v.attempts : 0,
    // 旧记录没有这个字段。当成「租期早就过了」而不是「刚被认领」：拿不准时
    // 宁可让下一跳有机会接手，重复由认领本身去挡。
    claimedAt: typeof v.claimedAt === "string" ? v.claimedAt : new Date(0).toISOString(),
  };
}

/**
 * 读这一天的投递记录。
 *
 * **读不到不等于没发过**——查询失败同样返回 null。所以它只能用来提前跳过
 * （省掉后面的文章查询），绝不能用来决定「可以发」。决定发不发的是
 * claimBriefingDelivery 里的那次 INSERT。
 */
async function readDeliveryRecord(slug: string): Promise<BriefingDeliveryRecord | null> {
  try {
    const { data, error } = await createServiceRoleClient()
      .from("admin_settings")
      .select("value")
      .eq("key", deliveryKey(slug))
      .maybeSingle();
    if (error) return null;
    return parseDeliveryRecord(data?.value);
  } catch {
    return null;
  }
}

/**
 * 改动上线的那一刻，当天的投递状态还在旧的单行 key 里。不认它的话，今天这条
 * 链接会因为「新的那一行还不存在」被当成没发过，再推一遍——正是这次要修的毛病。
 */
async function legacyDeliveredAt(slug: string): Promise<string | null> {
  try {
    const { data } = await createServiceRoleClient()
      .from("admin_settings")
      .select("value")
      .eq("key", LEGACY_DELIVERY_KEY)
      .maybeSingle();
    const record = parseDeliveryRecord(data?.value);
    return record && record.slug === slug ? record.deliveredAt : null;
  } catch {
    return null;
  }
}

/** 一天一行会堆起来，认领成功时顺手把别的天数（含旧的单行 key）删掉。 */
async function pruneOldDeliveryRows(keepKey: string): Promise<void> {
  try {
    await createServiceRoleClient()
      .from("admin_settings")
      .delete()
      .or(`key.like.${DELIVERY_KEY_PREFIX}*,key.eq.${LEGACY_DELIVERY_KEY}`)
      .neq("key", keepKey);
  } catch (err) {
    // 清理失败只是多留几行垃圾，不该影响这次投递
    console.error("[daily-briefing] failed to prune delivery rows", err);
  }
}

export type DeliveryClaimSkip =
  | "already_delivered"
  | "attempts_exhausted"
  | "in_flight"
  | "claim_failed";

type ClaimOutcome = { ok: true; attempts: number } | { ok: false; reason: DeliveryClaimSkip };

/** 认领「今天这条链接由我来发」。只有拿到 ok 的那个请求准发，其余一律不发。 */
async function claimBriefingDelivery(slug: string): Promise<ClaimOutcome> {
  const supabase = createServiceRoleClient();
  const key = deliveryKey(slug);
  const now = new Date().toISOString();

  // 先抢着建这一行。key 上有唯一约束，所以无论同时有多少个 tick 在跑、
  // 有多少次查询失败，一天里都只有一个请求能建成它。
  const { error } = await supabase.from("admin_settings").insert({
    key,
    value: { slug, deliveredAt: null, attempts: 1, claimedAt: now },
    description: DELIVERY_DESCRIPTION,
  });

  if (!error) {
    const legacy = await legacyDeliveredAt(slug);
    if (legacy) {
      // 旧记录说今天已经发过了：把结论搬进新的一行，这一轮不发。
      await markDelivered(slug, 1, legacy);
      return { ok: false, reason: "already_delivered" };
    }
    await pruneOldDeliveryRows(key);
    return { ok: true, attempts: 1 };
  }

  // 23505 以外的错误是「这次记不了账」，不是「没发过」。此时不发。
  if (error.code !== "23505") {
    console.error("[daily-briefing] failed to claim telegram delivery", error);
    return { ok: false, reason: "claim_failed" };
  }

  const current = await readDeliveryRecord(slug);
  // 行确实存在（刚刚才冲突过）却读不出来：同样按「不发」处理。
  if (!current) return { ok: false, reason: "claim_failed" };
  if (current.deliveredAt) return { ok: false, reason: "already_delivered" };
  if (current.attempts >= MAX_RETRY_ATTEMPTS) return { ok: false, reason: "attempts_exhausted" };
  if (Date.now() - Date.parse(current.claimedAt) < CLAIM_LEASE_MS) {
    return { ok: false, reason: "in_flight" };
  }

  // 接手重试：把 attempts 从 n 改成 n+1，**条件里带上 n**（比较并交换）。
  // 两个 tick 同时想接手时只有一个能匹配到 n，另一个更新到 0 行、老实退开。
  const attempts = current.attempts + 1;
  const { data: taken, error: casError } = await supabase
    .from("admin_settings")
    .update({ value: { slug, deliveredAt: null, attempts, claimedAt: now } })
    .eq("key", key)
    .eq("value->>attempts", String(current.attempts))
    .is("value->>deliveredAt", null)
    .select("key");

  if (casError || !taken || taken.length === 0) return { ok: false, reason: "in_flight" };
  return { ok: true, attempts };
}

/**
 * 记下「发出去了」。
 *
 * 这一步失败的代价是下一跳会再发一条，所以重试一次；两次都失败也不会失控——
 * 次数在认领时就已经记进去了，MAX_RETRY_ATTEMPTS 把重复封在 6 条以内。
 */
async function markDelivered(
  slug: string,
  attempts: number,
  at: string = new Date().toISOString()
): Promise<void> {
  const row = {
    key: deliveryKey(slug),
    value: { slug, deliveredAt: at, attempts, claimedAt: at },
    description: DELIVERY_DESCRIPTION,
  };
  for (let i = 0; i < 2; i++) {
    try {
      const { error } = await createServiceRoleClient()
        .from("admin_settings")
        .upsert(row, { onConflict: "key" });
      if (!error) return;
      console.error("[daily-briefing] failed to record telegram delivery", error);
    } catch (err) {
      console.error("[daily-briefing] failed to record telegram delivery", err);
    }
  }
}

/**
 * 退回认领。
 *
 * 配置类跳过（总开关关着、没勾目标、没 token）一条消息都没发出去，不该消耗
 * 补投次数——那是管理员的选择，不是故障。顺带把租期清掉，好让下一跳立刻能
 * 接手，而不用干等两分钟。
 */
async function releaseClaim(slug: string, attempts: number): Promise<void> {
  const key = deliveryKey(slug);
  try {
    const supabase = createServiceRoleClient();
    if (attempts <= 1) {
      // 这一行本来就是这次认领建的，删掉等于什么都没发生过
      await supabase.from("admin_settings").delete().eq("key", key).is("value->>deliveredAt", null);
      return;
    }
    await supabase
      .from("admin_settings")
      .update({
        value: {
          slug,
          deliveredAt: null,
          attempts: attempts - 1,
          claimedAt: new Date(0).toISOString(),
        },
      })
      .eq("key", key)
      .is("value->>deliveredAt", null);
  } catch (err) {
    // 退不回去只是白费一次补投次数，比多发一条好
    console.error("[daily-briefing] failed to release delivery claim", err);
  }
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
 * 真正发消息的那一步。**自己不做任何去重判断**——要不要发由调用方决定：
 * 自动路径走 deliverBriefingLinkOnce（先认领），后台按钮走
 * pushBriefingToTelegram（管理员显式点的，就该发）。
 *
 * @param slug     文章 slug，用来拼各语言的 URL
 * @param titles   按 locale 的标题（就是落库时那个 title 对象）
 */
async function sendBriefingLink(
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

  return { results };
}

/**
 * 后台「立即推送早报链接」用的入口：**无条件发**，发成功照样记账。
 *
 * 不认领是刻意的——管理员点按钮就是要它发，哪怕今天已经发过（比如上一条被
 * 误删了）。记账仍然写，这样 cron 不会在后面再补一条。
 */
export async function pushBriefingToTelegram(
  slug: string,
  titles: Record<string, string>
): Promise<BriefingPushOutcome> {
  const outcome = await sendBriefingLink(slug, titles);
  if (!outcome.skippedReason && outcome.results.some((r) => r.ok)) {
    const current = await readDeliveryRecord(slug);
    await markDelivered(slug, current?.attempts ?? 1);
  }
  return outcome;
}

export interface BriefingDeliverOutcome {
  /** 没投递时为什么跳过；正常投递时不存在 */
  skippedReason?: NonNullable<BriefingPushOutcome["skippedReason"]> | DeliveryClaimSkip;
  /** 这是今天第几次认领投递。没认领到时不存在 */
  attempts?: number;
  results: TargetDeliveryResult[];
}

/**
 * 自动路径（流水线 + 补投 tick）唯一的出口：先认领今天这条链接，认领不到就
 * 不发。所有「同一天发了两条」的路径——两个 tick 撞车、兜底稿升级成功后流水线
 * 再推一次、判据查询失败——都收敛到这一个闸门上。
 */
export async function deliverBriefingLinkOnce(
  slug: string,
  titles: Record<string, string>
): Promise<BriefingDeliverOutcome> {
  const claim = await claimBriefingDelivery(slug);
  if (!claim.ok) return { skippedReason: claim.reason, results: [] };

  const outcome = await sendBriefingLink(slug, titles);

  if (outcome.skippedReason) {
    await releaseClaim(slug, claim.attempts);
    return { skippedReason: outcome.skippedReason, results: outcome.results };
  }

  // 「至少一个目标成功」就算发过了。部分失败不再补投是刻意的：补投会给已经
  // 收到的那些目标再发一遍，而重复消息比某个频道少一条更烦人；那种情况有
  // 告警和后台的手动按钮。
  if (outcome.results.some((r) => r.ok)) await markDelivered(slug, claim.attempts);

  return { results: outcome.results, attempts: claim.attempts };
}

export interface BriefingRetryOutcome {
  /** 没做事时的原因，便于 cron 日志区分「没必要补」和「补了」 */
  skipped?:
    | "already_delivered"
    | "no_article_today"
    | "attempts_exhausted"
    | "not_configured"
    | "not_final"
    | "in_flight"
    | "claim_failed";
  slug?: string;
  delivered?: boolean;
}

function retrySkipFor(
  reason: NonNullable<BriefingDeliverOutcome["skippedReason"]>
): BriefingRetryOutcome["skipped"] {
  // 配置类跳过（总开关关着、没目标、没 token）不是故障，是管理员的选择
  if (reason === "disabled" || reason === "no_targets" || reason === "no_token") {
    return "not_configured";
  }
  return reason;
}

/**
 * 补投今天的早报链接——由高频 tick 调用（见 /api/cron/telegram-push）。
 *
 * 流水线一天只跑一次，所以它那次投递失败就是永久失败。这个函数把「漏掉的
 * 一轮由下一轮补上」这条本项目已有的原则，从榜单推送搬到早报链接上。
 *
 * 收敛条件分两层，作用完全不同：
 * 1. 这里的预检（已投递、次数用完、还没定稿、今天还没出稿）只负责**便宜地
 *    早退**，省掉后面的查询与一次投递预算。
 * 2. 「同一天只发一条」由 deliverBriefingLinkOnce 的认领保证。预检读不到记录
 *    时不会放行成「那就发吧」——那正是原先一天推十几条的根因。
 */
export async function retryUndeliveredBriefingLink(): Promise<BriefingRetryOutcome> {
  const todaySlug = briefingSlug(utcPlus8DateString(Date.now()));

  // 最便宜的检查放最前：正常情况下今天的链接早发完了，一次查询就能返回。
  const pre = await readDeliveryRecord(todaySlug);
  if (pre?.deliveredAt) return { skipped: "already_delivered", slug: todaySlug };
  if (pre && pre.attempts >= MAX_RETRY_ATTEMPTS) {
    return { skipped: "attempts_exhausted", slug: todaySlug };
  }

  // 兜底稿还在升级重试中就先别推：链接只发一次，推早了读者点开的是那篇待会儿
  // 就会被替换掉的稿子。定稿（升级成功或次数用完）之后下一个 tick 自然会把它
  // 发出去——这正是补投机制存在的意义。
  if (!isFinal(await readPublishState(), todaySlug)) {
    return { skipped: "not_final", slug: todaySlug };
  }

  const { data } = await createServiceRoleClient()
    .from("articles")
    .select("slug, title")
    .eq("slug", todaySlug)
    .eq("is_published", true)
    .maybeSingle();

  // 今天还没出稿：不是要补投的场景，等流水线自己发。
  if (!data) return { skipped: "no_article_today" };

  const outcome = await deliverBriefingLinkOnce(
    todaySlug,
    (data.title ?? {}) as Record<string, string>
  );
  if (outcome.skippedReason) {
    return { skipped: retrySkipFor(outcome.skippedReason), slug: todaySlug };
  }

  const delivered = outcome.results.some((r) => r.ok);

  // 次数刚好耗尽且仍未成功：告警一次，之后彻底安静。静默放弃正是这套补投
  // 机制要终结的东西。
  if (!delivered && (outcome.attempts ?? 0) >= MAX_RETRY_ATTEMPTS) {
    const detail = outcome.results
      .filter((r) => !r.ok)
      .map((r) => `${r.label}: ${r.error ?? "unknown"}`)
      .join("; ");
    await alertBriefing(`早报链接补投 ${MAX_RETRY_ATTEMPTS} 次仍未成功，已放弃：${detail}`);
  }

  return { slug: todaySlug, delivered };
}
