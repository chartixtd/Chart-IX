import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildContentMessage } from "@/lib/push/messages";
import { translateBriefingJson } from "@/lib/briefing/translate-json";
import { briefingSlug, utcPlus8DateString, utcPlus8Hour } from "@/lib/briefing/date";
import { fetchBriefingSources, MIN_SOURCE_ITEMS } from "@/lib/briefing/sources";
import { fetchMarketFacts } from "@/lib/briefing/market-facts";
import { buildBriefingPrompt } from "@/lib/briefing/prompt";
import { callDeepSeek, DEFAULT_TIMEOUT_MS } from "@/lib/briefing/deepseek";
import { checkBriefing, parseBriefingJson } from "@/lib/briefing/quality-gate";
import { renderBriefingHtml } from "@/lib/briefing/render";
import { fallbackTitle, renderFallbackHtml } from "@/lib/briefing/fallback";
import { alertBriefing as alert } from "@/lib/briefing/alert";
import type { BriefingJson, BriefingLocale, BriefingSource, MarketFact } from "@/lib/briefing/types";

const JOB_NAME = "daily-briefing";
const LOCALES: BriefingLocale[] = ["zh-CN", "en-US"];

/**
 * 整条流水线的墙钟预算。
 *
 * 两个路由都是 maxDuration=60，而本项目跑在 Vercel Hobby——60 秒是套餐上限、
 * 不可调（触发器是 vercel.json 的 crons，每天一次）。被平台掐断时没有 insert、
 * 没有心跳、没有告警：心跳停在旧值，而 Vercel Cron 的失败只体现在平台日志里，
 * 没人会主动去看。而 L3/L4/L5 **每一级都在生成步骤之后**，所以超时会绕过整套降级
 * 架构——兜底稿存在的意义就是保证栏目不断更，它却恰恰在最需要它的场景里够不着。
 *
 * 48 秒给流水线，剩下约 12 秒留给冷启动、落库、推送与心跳。
 */
export const PIPELINE_BUDGET_MS = 48_000;

/**
 * 剩余预算低于这个数就不再发起新的模型调用，直接落到 L4（兜底稿是纯字符串
 * 拼接 + 一次 insert，几百毫秒就能跑完）。宁可发一篇朴素的稿，也不要被平台
 * 掐死在第三次尝试里、什么都没写。
 *
 * 曾经是 8 秒，配 22 秒的单次超时。线上实测把这个组合证伪了：一次生成本身就
 * 要 20 秒以上，所以「还剩 14 秒，再试一次」根本不可能成功——只是拿注定超时的
 * 一次调用把剩余预算也烧掉。门槛必须大于等于一次生成的实际耗时，否则重试只是
 * 在浪费时间。
 *
 * 取 20 秒：快速失败（HTTP 4xx/5xx、空内容，耗时不到 1 秒）之后仍有充裕预算
 * 重试——那才是重试真正能救回来的场景；而超时之后直接落到 L4。
 */
export const MIN_CALL_BUDGET_MS = 20_000;

/**
 * 发布时间窗（UTC+8 小时，闭区间）。
 *
 * 闸门放在流水线里，**不依赖外部触发器怎么接线**。当前唯一的触发器是
 * vercel.json 的 `0 1 * * *`（UTC+8 09:00），本来就落在窗口内；但闸门不是为它
 * 准备的，而是为「以后有人再挂一个高频 tick」准备的——给某个 GitHub Actions job
 * 加一条 schedule 并不能限定其中某个 step，那个 step 会在每次 tick 上全部触发。
 * 流水线内部若没有小时闸门，UTC+8 日期一翻篇（UTC 16:00）的第一次 tick 就会
 * 发文——日期正确，但当地时间约 00:05 发布的"早报"。
 *
 * 幂等闸门保证窗口内打多少次都只出一篇。
 */
/** 导出供后台测试页显示——复制这两个数字会随时间和这里漂移 */
export const PUBLISH_HOUR_START = 8;
export const PUBLISH_HOUR_END = 11;

export interface BriefingRunResult {
  status: "published" | "fallback" | "skipped" | "failed";
  slug: string;
  detail?: string;
  /** 本次运行记下的降级/失败原因，按发生顺序。正常发布时为空数组 */
  reasons?: string[];
}

export interface BriefingRunOptions {
  /** 后台手动触发用：绕过发布时间窗闸门，否则白天没法调试与补发 */
  ignoreSchedule?: boolean;
  /**
   * 后台调试用：先删掉今天已有的那篇再重新生成。
   *
   * 幂等闸门让「今天再跑一次」变成 skipped，这在正常运行时正是我们要的，
   * 但在排查「为什么降级了」时会把人卡死——只能去数据库手动删。
   * 只有 admin 路由会传这个，cron 永远不传。
   */
  force?: boolean;
}

/** 最近一次运行的诊断落在 admin_settings 的这个键下，供后台测试页读取 */
const LAST_RUN_KEY = "daily_briefing_last_run";

/**
 * 非终局告警一律**不 await**。
 *
 * PIPELINE_BUDGET_MS 只约束了 DeepSeek 调用，可 `alert()` 恰恰只在失败分支触发——
 * 正是预算已经很紧的时候。sendTelegramMessage 是 10s 超时 × 3 次尝试加退避，
 * 且 backoffDelayMs 会照单遵守 Telegram 返回的 retry_after，一条被限流的消息
 * 最多耗约 31.5 秒；而糟糕的一天会朝同一个 chat 连发 6-9 条，那正是触发限流的
 * 条件。await 下去等于把整条流水线挂在告警上，重新掉回「被平台掐断 → 无 insert、
 * 无心跳、无告警」那条路——预算存在的意义就是不让这件事发生。
 *
 * 不 await 是安全的，理由有三：
 * 1. alertBriefing 开头的 console.error 与 Sentry.captureMessage 是**同步**执行的，
 *    真正会掉的只有 Telegram 那一路投递，可观测性的主干一点没少。
 * 2. alertBriefing 自己吞掉全部异常（见 alert.ts 的 try/catch），不会产生
 *    unhandledRejection。
 * 3. 另一种改法（把剩余预算传进去、据此收缩 maxAttempts/timeoutMs）仍然把
 *    一次 admin_settings 查询加一次 Telegram 往返留在关键路径上，×6 条告警，
 *    只是把暴露变小而不是消除。
 *
 * 终局告警（后面只剩 beat + return，没有还能被掐断掉的工作）保留 await。
 */
function alertNoWait(message: string): void {
  void alert(message);
}

/**
 * 记录一条降级/失败原因，并按非终局告警的方式发出去。
 *
 * 补这个是因为线上第一次真跑就暴露了一个真空：兜底稿发出来了，而「为什么没走
 * AI」只存在于 console 与 Sentry 里——后台什么都看不到，运维要回答最基本的
 * 「它为什么降级」都得去翻另一个系统。诊断随运行结果一起返回，并落到
 * admin_settings，这样 cron 在无人值守时段降级也能事后查。
 */
function note(diag: string[], message: string): void {
  trace(diag, message);
  alertNoWait(message);
}

/**
 * 只记录、不告警。用于「成功且耗时多少」这类信息——它们是调超时值的唯一依据
 * （第一版 22 秒就是猜的，线上实测才发现一次生成都不够），但为一次正常发布
 * 发 Telegram 是骚扰。
 */
function trace(diag: string[], message: string): void {
  diag.push(message);
}

/** 终局原因：后面只剩 beat + return，可以安全 await */
async function noteAwait(diag: string[], message: string): Promise<void> {
  diag.push(message);
  await alert(message);
}

/**
 * 心跳：让「没有文章」可以和「任务根本没跑」区分开。
 *
 * 四个状态的语义必须互不重叠，否则 cron_heartbeats 回答不了运维真正要问的那个
 * 问题——「今天的早报发出去了吗」：
 * - `ok`      本次 tick 真的写了一篇（正常稿或兜底稿）
 * - `error`   跑到了、但没写成
 * - `skipped` 今天**已经有稿**，本次 tick 幂等早退（含唯一约束冲突）
 * - `idle`    在发布时间窗之外，本次 tick 什么都没做
 *
 * `skipped` 与 `idle` 曾经是同一个值，于是窗口外的 tick 会在发文后不久把 `ok`
 * 覆盖掉，监控看到的永远是同一个绿色状态，哪怕一篇都没发过。分开之后
 * `ok`/`skipped` 都蕴含「今天已经有稿」，`idle` 则明确表示「还没到点」。
 * cron_heartbeats.last_status 是无约束的 TEXT（见 026 迁移），加值不需要改库；
 * 后台与用户端的心跳展示都只读 job_name = 'telegram-push'，不受影响。
 */
async function beat(status: "ok" | "error" | "skipped" | "idle") {
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

/**
 * 生成一语。失败或不过门槛时换备用模型再试一次（降级阶梯 L1/L2）。
 *
 * `deadlineMs` 是整条流水线的墙钟终点，中英两语共享同一个终点（它们是并发跑的）。
 * 每次调用前先看剩余预算：不够一次完整调用就不再尝试，让调用方尽快落到 L4。
 */
async function generateOne(
  locale: BriefingLocale,
  sources: BriefingSource[],
  facts: MarketFact[],
  dateStr: string,
  deadlineMs: number,
  diag: string[]
): Promise<BriefingJson | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY!;
  const prompt = buildBriefingPrompt(sources, facts, locale, dateStr);
  const models = [
    process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    process.env.DEEPSEEK_MODEL || "deepseek-v4-flash", // L1: 同模型重试一次（空内容是已知偶发问题）
    process.env.DEEPSEEK_FALLBACK_MODEL || "deepseek-v4-pro", // L2: 换模型
  ];

  for (const [attempt, model] of models.entries()) {
    const remaining = deadlineMs - Date.now();
    if (remaining < MIN_CALL_BUDGET_MS) {
      note(
        diag,
        `${locale} 剩余预算 ${Math.max(0, remaining)}ms 不足以再发起第 ${attempt + 1} 次调用，停止重试`
      );
      return null;
    }
    // 超时取「单次上限」与「剩余预算」的较小者：最后一次尝试不能跨过 deadline，
    // 否则被平台掐断的又是那条什么都没写的路径。
    const startedAt = Date.now();
    const res = await callDeepSeek({
      apiKey,
      model,
      prompt,
      timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, remaining),
    });
    // 耗时必须记进诊断：超时值该设多少全靠它，没有它就只能靠猜——
    // 第一版 22 秒就是猜出来的，线上实测才发现一次生成都不够。
    const tookMs = Date.now() - startedAt;
    if (!res.ok) {
      note(diag, `${locale} 第 ${attempt + 1} 次调用失败(${model}, 耗时 ${tookMs}ms): ${res.error}`);
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
    if (gate.ok && parsed) {
      trace(diag, `${locale} 第 ${attempt + 1} 次生成成功(${model}, 耗时 ${tookMs}ms)`);
      return parsed;
    }
    note(
      diag,
      `${locale} 第 ${attempt + 1} 次未过质量门槛(${model}, 耗时 ${tookMs}ms): ` +
        gate.failures.map((f) => `${f.rule}/${f.detail}`).join("; ")
    );
  }
  return null;
}

async function runPipeline(
  nowMs: number,
  options: BriefingRunOptions,
  diag: string[]
): Promise<BriefingRunResult> {
  // 墙钟终点用 Date.now() 而不是 nowMs：nowMs 是「逻辑当下」（日期、24h 窗口都
  // 按它算，测试会喂固定值），预算要的是真实流逝时间。
  const deadlineMs = Date.now() + PIPELINE_BUDGET_MS;
  const dateStr = utcPlus8DateString(nowMs);
  const slug = briefingSlug(dateStr);

  // ⓪ 发布时间窗。放在最前面：窗口外的 tick 一天有 130+ 次，任何更贵的检查
  //    （包括缺环境变量的告警）都不该被它们触发。
  const hour = utcPlus8Hour(nowMs);
  if (!options.ignoreSchedule && (hour < PUBLISH_HOUR_START || hour > PUBLISH_HOUR_END)) {
    // 写 idle 而不是 skipped：窗口外的 tick 只说明「还没到点」，不能和
    // 「今天已经发过了」共用一个状态值，否则它会把 ok 覆盖成一个含义模糊的绿灯
    await beat("idle");
    return { status: "skipped", slug, detail: `UTC+8 ${hour} 时不在发布窗口内` };
  }

  const supabase = createServiceRoleClient();

  const authorId = process.env.BRIEFING_AUTHOR_ID;
  if (!process.env.DEEPSEEK_API_KEY || !authorId) {
    await noteAwait(diag, "缺少 DEEPSEEK_API_KEY 或 BRIEFING_AUTHOR_ID 环境变量");
    await beat("error");
    return { status: "failed", slug, detail: "missing env" };
  }

  // ①′ 强制重跑：只有后台调试会走到这里。删掉今天那篇再往下走，
  //     否则幂等闸门会让每次重试都变成 skipped，人被卡在「想看它为什么降级
  //     却跑不起来」的死角里。
  if (options.force) {
    const { error: delError } = await supabase.from("articles").delete().eq("slug", slug);
    if (delError) {
      await noteAwait(diag, `强制重跑时删除旧稿失败: ${delError.message}`);
      await beat("error");
      return { status: "failed", slug, detail: delError.message };
    }
    note(diag, `强制重跑：已删除既有的 ${slug}`);
  }

  // ① 幂等闸门。真正的并发保护是 articles.slug 的 UNIQUE 约束（见 ⑤），
  //    这次查询只是为了让重复 tick 便宜地早退。
  const { data: existing } = await supabase
    .from("articles")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    // skipped = 今天已经有稿。它和 ok 一样蕴含「早报发出去了」
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
    await noteAwait(diag, "新闻与行情全部获取失败，今日无法出稿");
    await beat("error");
    return { status: "failed", slug, detail: "no material" };
  }

  // ③④ 素材充足才调用模型；否则直接兜底
  const title: Record<string, string> = {};
  const content: Record<string, string> = {};
  let degraded = sources.length < MIN_SOURCE_ITEMS;

  if (degraded) {
    note(diag, `24h 内仅 ${sources.length} 条新闻，低于 ${MIN_SOURCE_ITEMS}，直接走兜底稿`);
  } else {
    // 用 allSettled 而非 all：L3 这一级存在的意义就是「一语成功就别丢掉它」。
    // 若某天 generateOne 内部抛了（现在不会，但它调的东西以后可能变），Promise.all
    // 会让整轮直接判失败，把已经生成好的另一语一起扔掉——恰好绕过 L3。
    const [zhSettled, enSettled] = await Promise.allSettled([
      generateOne("zh-CN", sources, facts, dateStr, deadlineMs, diag),
      generateOne("en-US", sources, facts, dateStr, deadlineMs, diag),
    ]);
    // rejection 原因不能静默丢弃：本文件其他失败模式都会 alert()，
    // 运维排查「en-US 为什么走了翻译」时必须看得到真正抛出的错误。
    for (const [i, settled] of [zhSettled, enSettled].entries()) {
      if (settled.status === "rejected") {
        note(diag, `${LOCALES[i]} 生成过程抛出异常: ${String(settled.reason)}`);
      }
    }
    const zh = zhSettled.status === "fulfilled" ? zhSettled.value : null;
    const en = enSettled.status === "fulfilled" ? enSettled.value : null;

    if (zh && en) {
      title["zh-CN"] = zh.title;
      title["en-US"] = en.title;
      content["zh-CN"] = renderBriefingHtml(zh, facts, sources, "zh-CN");
      content["en-US"] = renderBriefingHtml(en, facts, sources, "en-US");
    } else if (zh || en) {
      // L3：两语中恰有一语成功，另一语走翻译通道。
      // en-US 缺失会让英文与马来文读者看到空白正文，绝不能留空——但「留空」的
      // 反面不是「随便填点什么」：把中文正文塞进 content["en-US"] 比留空更糟，
      // 因为正文回退链 content[locale] ?? content["en-US"] 会让英文与马来文
      // 读者都看到中文文章，而告警还写着「已用翻译通道兜住」。
      const okLocale: BriefingLocale = zh ? "zh-CN" : "en-US";
      const badLocale: BriefingLocale = zh ? "en-US" : "zh-CN";
      const good = (zh ?? en)!;
      const from = okLocale === "zh-CN" ? "zh" : "en";
      const to = badLocale === "zh-CN" ? "zh" : "en";

      // 已经过了质量门槛的那一语先落定，**不放在翻译成功分支里**：翻译失败时
      // 也不能把它一起丢掉。下面的 L4 只填还空着的语言，于是「AI 中文 + 兜底
      // 英文」取代了原先的「兜底中文 + 兜底英文」——前者严格更好，而兜底稿的
      // 标题与正文本来就按 locale 分别生成，混搭是安全的。
      title[okLocale] = good.title;
      content[okLocale] = renderBriefingHtml(good, facts, sources, okLocale);

      // 翻译同样受墙钟预算约束：生成阶段可能已经吃掉大半预算，此时宁可直接发
      // 兜底稿，也不要在翻译途中被平台掐断而什么都没写。
      let translated =
        deadlineMs - Date.now() >= MIN_CALL_BUDGET_MS
          ? await translateBriefingJson(good, from, to, badLocale)
          : null;

      // 机器翻译产物必须重跑**同一把尺子**。translateBriefingJson 内部只查了
      // 语种占比，而 TITLE_MAX(60) 与 BANNED_PHRASES（含 "price target"、
      // "guaranteed" 等英文条目）从未作用于翻译结果：中文标题译成英文很容易
      // 超长，中文的合规表述也可能被译成禁用短语，于是一篇本该被拦下的稿子
      // 会绕过门槛直接发布。不过就当作翻译失败，落到 L4。
      if (translated) {
        const gate = checkBriefing({
          json: translated,
          facts,
          sources,
          locale: badLocale,
          finishReason: null,
        });
        if (!gate.ok) {
          note(
      diag,
            `${badLocale} 翻译结果未过质量门槛: ` +
              gate.failures.map((f) => `${f.rule}/${f.detail}`).join("; ")
          );
          translated = null;
        }
      }

      if (translated) {
        // 用翻译后的**字段**重新渲染，而不是翻译渲染好的 HTML：小标题、括号
        // 样式、免责声明都会正确本地化，价格与链接原样不动。
        title[badLocale] = translated.title;
        content[badLocale] = renderBriefingHtml(translated, facts, sources, badLocale);
        note(diag, `${badLocale} 生成失败，已用翻译通道兜住`);
      } else {
        degraded = true;
        note(diag, `${badLocale} 生成失败且翻译通道也失败，${badLocale} 改发零 AI 兜底稿`);
      }
    } else {
      degraded = true;
      note(diag, "中英两语均未通过质量门槛，改发零 AI 兜底稿");
    }
  }

  // L4：零 AI 兜底稿。**只填还空着的语言**——L3 部分成功时（一语的 AI 稿已经
  // 过了门槛、另一语翻译失败）不能把那篇已经合格的稿子一起覆盖掉。
  // 用 content 当哨兵：title 与 content 在上面每一条路径里都是成对赋值的。
  if (degraded) {
    for (const locale of LOCALES) {
      if (content[locale]) continue;
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
    await noteAwait(diag, `落库失败: ${insertError.message}`);
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

      // 按订阅语言分组，每组只调一次——sendToSubscriptions 内部已经用 Promise.all
      // 并发发送。逐个订阅者 await 会让这段随订阅数线性变长，而它跑在文章**已经
      // 落库发布之后**、maxDuration=60 的函数里：被平台掐断就会出现「文章发了、
      // 心跳还是旧的」，正是 cron_heartbeats 当初要防的静默失效。
      // 分组键用订阅自带的 locale（而非归一后的内容语言），这样 ms-MY 用户点开的
      // 仍是 /ms-MY/ 链接，只是正文回退成英文。
      const byLocale = new Map<string, typeof subs>();
      for (const sub of subs) {
        // SubscriptionRow.locale 是未经运行时校验的类型断言，DB 里的 null
        // 会一路变成 /null/articles/... 这种打不开的链接
        const subLocale = sub.locale ?? "en-US";
        const group = byLocale.get(subLocale);
        if (group) group.push(sub);
        else byLocale.set(subLocale, [sub]);
      }

      for (const [subLocale, group] of byLocale) {
        const contentLocale: BriefingLocale = subLocale === "zh-CN" ? "zh-CN" : "en-US";
        const msg = buildContentMessage(contentLocale, "article", title[contentLocale]);
        await sendToSubscriptions(group, {
          title: msg.title,
          body: msg.body,
          url: `/${subLocale}/articles/${slug}`,
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
export async function runDailyBriefing(
  nowMs: number,
  options: BriefingRunOptions = {}
): Promise<BriefingRunResult> {
  const diag: string[] = [];
  try {
    const result = await runPipeline(nowMs, options, diag);
    const withReasons = { ...result, reasons: diag };
    await recordLastRun(withReasons);
    return withReasons;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { scope: "daily-briefing" } });
    await alert(`流水线异常: ${message}`);
    await beat("error");
    // slug 要重算，但 utcPlus8DateString 对非有限的 nowMs 会抛 RangeError——
    // 那正是把我们送进这个 catch 的同一行。兜底路径自己再抛一次就会击穿
    // 「runDailyBriefing 永不抛出」这个两个调用方都依赖的契约。
    let slug = "unknown";
    try {
      slug = briefingSlug(utcPlus8DateString(nowMs));
    } catch {
      /* 保持 "unknown" */
    }
    diag.push(`流水线异常: ${message}`);
    const failed: BriefingRunResult = { status: "failed", slug, detail: message, reasons: diag };
    await recordLastRun(failed);
    return failed;
  }
}

/**
 * 把这次运行的结果与全部降级原因写进 admin_settings，供后台测试页显示。
 *
 * 为什么要落库而不只是随响应返回：cron 在无人值守时段跑，等运维发现「今天怎么
 * 是兜底稿」的时候，那次响应早就没了。写失败绝不能影响主流程——文章此时通常
 * 已经发布成功了。
 */
async function recordLastRun(result: BriefingRunResult): Promise<void> {
  try {
    await createServiceRoleClient()
      .from("admin_settings")
      .upsert(
        {
          key: LAST_RUN_KEY,
          value: {
            at: new Date().toISOString(),
            status: result.status,
            slug: result.slug,
            detail: result.detail ?? null,
            reasons: result.reasons ?? [],
          },
          description: "每日早报最近一次运行的诊断（程序自动写入）",
        },
        { onConflict: "key" }
      );
  } catch (err) {
    console.error("[daily-briefing] recordLastRun failed", err);
  }
}
