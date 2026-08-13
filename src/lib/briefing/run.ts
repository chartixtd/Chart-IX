import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildContentMessage } from "@/lib/push/messages";
import { translateBriefingJson } from "@/lib/briefing/translate-json";
import { briefingSlug, utcPlus8DateString, utcPlus8Hour } from "@/lib/briefing/date";
import { fetchBriefingSources, MIN_SOURCE_ITEMS } from "@/lib/briefing/sources";
import { fetchArticleBodies, MAX_BODIES } from "@/lib/briefing/extract";
import { fetchMarketFacts } from "@/lib/briefing/market-facts";
import { buildBriefingPrompt } from "@/lib/briefing/prompt";
import { callDeepSeek, DEFAULT_TIMEOUT_MS } from "@/lib/briefing/deepseek";
import { checkBriefing, parseBriefingJson } from "@/lib/briefing/quality-gate";
import { renderBriefingHtml } from "@/lib/briefing/render";
import { fallbackTitle, renderFallbackHtml } from "@/lib/briefing/fallback";
import { normalizeBriefingTitle } from "@/lib/briefing/title";
import { alertBriefing as alert } from "@/lib/briefing/alert";
import { pushBriefingToTelegram, BRIEFING_TELEGRAM_BUDGET_MS } from "@/lib/briefing/telegram";
import { revalidateArticleLists } from "@/lib/articles-revalidate";
import type { SourceWithBody } from "@/lib/briefing/extract";
import type { BriefingJson, BriefingLocale, MarketFact } from "@/lib/briefing/types";

const JOB_NAME = "daily-briefing";
const LOCALES: BriefingLocale[] = ["zh-CN", "en-US"];

/**
 * 原生生成的语言。另一语一律由它翻译而来。
 *
 * 选中文不是偏好，是实测：同一批素材，中文一次生成约 11 秒，英文要 24 秒以上
 * 且经常返回空——同等信息量下英文的 token 数远多于中文，而承载路由只有 60 秒
 * 硬上限。以中文为主语言，生成阶段就有充裕余量。
 */
const PRIMARY_LOCALE: BriefingLocale = "zh-CN";
const SECONDARY_LOCALE: BriefingLocale = "en-US";

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
 * 翻译阶段的预算门槛，比模型调用低得多。
 *
 * translateBriefingJson 是十几个并发的短请求（每个字段一条），几秒就能跑完，
 * 和一次动辄二十秒的模型生成完全不是一个量级。用 MIN_CALL_BUDGET_MS 去卡它，
 * 会在生成偏慢的日子白白放弃一次本来来得及的翻译，把英文版无谓地降级成兜底稿。
 */
const MIN_TRANSLATE_BUDGET_MS = 8_000;

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
  sources: SourceWithBody[],
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

  // ① 幂等闸门。真正的并发保护是 articles.slug 的 UNIQUE 约束（见 ⑤），
  //    这次查询只是为了让重复 tick 便宜地早退。force 时跳过——旧稿的删除
  //    **推迟到新稿内容就绪之后**（见 ⑤ 前），这样生成中途任何一步失败，
  //    昨天点「重新生成」的人手里至少还留着原来那篇，而不是一篇都没有。
  if (!options.force) {
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
    // 抓正文。只给标题的话，模型只能写出「复述标题」级别的空话——这是早报
    // 第一版读起来言之无物的直接原因。抓失败是常态（付费墙、反爬、超时），
    // 那些条目退回只用 RSS 摘要，不影响出稿。
    const fetchStart = Date.now();
    const withBodies = await fetchArticleBodies(sources);
    const gotBodies = withBodies.filter((s) => s.body).length;
    trace(
      diag,
      `正文抓取：${gotBodies}/${Math.min(MAX_BODIES, sources.length)} 篇成功，耗时 ${
        Date.now() - fetchStart
      }ms`
    );

    // **只原生生成主语言，另一语一律走翻译。**
    //
    // 曾经是中英各生成一次（并发）。线上实测推翻了它：中文一次生成约 11 秒，
    // 英文同样的内容要 24 秒以上还经常返回空——同等信息量下英文的 token 数
    // 远多于中文，而承载路由只有 60 秒硬上限（Vercel Hobby，不可调）。于是
    // 英文那一路几乎每天超时，整篇退化成零 AI 兜底稿。
    //
    // 译文质量的损失，远小于「每天有一半概率完全没有 AI 内容」的损失；而且
    // 翻译走的是字段级重渲染（见下），小标题、括号样式、免责声明都会正确
    // 本地化，价格与数字原样不动。副作用是中英内容必然一致，不会再出现两语
    // 各说各话。
    // 包一层 catch 而不是直接 await：generateOne 现在不会抛（callDeepSeek 是
    // total 的，门槛与解析也都不抛），但它调的东西以后可能变。一次意外的抛出
    // 应当降级成兜底稿——那正是兜底稿存在的意义——而不是让整轮变成 failed、
    // 今天一篇都没有。旧的两语并发版本靠 allSettled 得到这个性质，改成单次
    // 生成后必须显式补回来。
    let primary: BriefingJson | null = null;
    try {
      primary = await generateOne(PRIMARY_LOCALE, withBodies, facts, dateStr, deadlineMs, diag);
    } catch (err) {
      note(diag, `${PRIMARY_LOCALE} 生成过程抛出异常: ${String(err)}`);
    }

    if (!primary) {
      degraded = true;
      note(diag, `${PRIMARY_LOCALE} 未能生成，改发零 AI 兜底稿`);
    } else {
      const badLocale = SECONDARY_LOCALE;
      const from = PRIMARY_LOCALE === "zh-CN" ? "zh" : "en";
      const to = badLocale === "zh-CN" ? "zh" : "en";

      // 主语言先落定，**不放在翻译成功分支里**：翻译失败时也不能把它一起丢掉。
      // 下面的 L4 只填还空着的语言，于是「AI 中文 + 兜底英文」取代了原先的
      // 「兜底中文 + 兜底英文」——前者严格更好，而兜底稿的标题与正文本来就
      // 按 locale 分别生成，混搭是安全的。
      // 标题一律过一遍格式归一：模型给的标题时而是「早报｜8月9日 …」、时而照抄
      // prompt 示例里的「8月8日」、时而只有正题。日期以我们算出的 dateStr 为准。
      title[PRIMARY_LOCALE] = normalizeBriefingTitle(primary.title, dateStr, PRIMARY_LOCALE);
      content[PRIMARY_LOCALE] = renderBriefingHtml(primary, facts, PRIMARY_LOCALE);

      // 翻译同样受墙钟预算约束，但门槛比模型调用低得多：它是十几个并发的短
      // 请求，几秒就能跑完，用 MIN_CALL_BUDGET_MS(20s) 卡它会在生成偏慢的
      // 日子白白放弃一次本来来得及的翻译。
      let translated =
        deadlineMs - Date.now() >= MIN_TRANSLATE_BUDGET_MS
          ? await translateBriefingJson(primary, from, to, badLocale)
          : null;

      // 机器翻译产物必须重跑**同一把尺子**。translateBriefingJson 内部只查了
      // 语种占比，而 TITLE_MAX(60) 与 BANNED_PHRASES（含 "price target"、
      // "guaranteed" 等英文条目）从未作用于翻译结果：中文标题译成英文很容易
      // 超长，中文的合规表述也可能被译成禁用短语，于是一篇本该被拦下的稿子
      // 会绕过门槛直接发布。不过就当作翻译失败，落到 L4。
      if (translated) {
        // 必须传 withBodies，不能传外层的 sources（不含正文）。
        // 生成阶段模型读的是 withBodies——它能从正文里读出「150万美元」这类
        // 数字。若这里退回不含正文的 sources，白名单就只看得到 RSS 的标题和
        // 摘要，找不到这个数字，把刚翻译好、内容完全正确的英文版错判为编造，
        // 落到兜底稿。线上真实发生过一次，就是这里的变量传错了。
        const gate = checkBriefing({
          json: translated,
          facts,
          sources: withBodies,
          locale: badLocale,
          finishReason: null,
          // 原稿已经跑完整套门槛，它出现过的数字对译文就是可信基准。
          // 不传的话，中文「70亿美元」译成 "$7 billion" 会被判成编造——
          // 数字核对只查带 $ 的写法，这条规则结构上只咬英文版。
          baseline: primary,
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
        // 样式、免责声明都会正确本地化，价格与数字原样不动。
        // 翻译器会把「早报 | 8月10日」译成 Morning Post / Daily Report 等各种说法，
        // 日期也可能被写成 August 10 —— 同样归一到英文侧的标准格式
        title[badLocale] = normalizeBriefingTitle(translated.title, dateStr, badLocale);
        content[badLocale] = renderBriefingHtml(translated, facts, badLocale);
        trace(diag, `${badLocale} 已由 ${PRIMARY_LOCALE} 翻译生成`);
      } else {
        degraded = true;
        note(diag, `${badLocale} 翻译失败，${badLocale} 改发零 AI 兜底稿`);
      }
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

  // 强制重跑的删除放在这里、内容全部就绪之后，而不是流水线开头。
  // 早删的话，生成中途任何一步失败（RSS 全挂、模型全失败、连兜底稿都渲染不出）
  // 都会让当天从「有一篇稿」变成「一篇都没有」——操作者只是点了个「重新生成」，
  // 却把原有的文章弄丢了。删除失败按 failed 处理，此时旧稿原封不动。
  if (options.force) {
    const { error: delError } = await supabase.from("articles").delete().eq("slug", slug);
    if (delError) {
      await noteAwait(diag, `强制重跑时删除旧稿失败: ${delError.message}`);
      await beat("error");
      return { status: "failed", slug, detail: delError.message };
    }
    note(diag, `强制重跑：已删除既有的 ${slug}`);
    // 删除已生效——即使后面的 insert 失败，缓存里的旧条目也不能再指向 404
    revalidateArticleLists();
  }

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

  // 列表页有 5 分钟静态缓存。cron 自动发布同样要主动失效，否则早上 9 点
  // 发出的早报最多要到 9:05 才出现在文章列表里。
  revalidateArticleLists();

  // 心跳与诊断在**推送之前**写。推送跑在预算已经花完的尾巴上，且
  // sendToSubscriptions 对单个端点没有超时——一个慢的 FCM 端点可以把函数
  // 拖到被平台掐断。掐断发生在这行之后，损失的只是推送；发生在这行之前，
  // 损失的是「文章发了、心跳还是旧的」——正是 cron_heartbeats 要防的状态。
  await beat("ok");
  const result: BriefingRunResult = {
    status: degraded ? "fallback" : "published",
    slug,
    reasons: diag,
  };
  await recordLastRun(result);

  // ⑥ Telegram：把文章网址推给订阅了「早报」的目标（可指定话题）。
  //
  // 排在 Web Push **之前**，因为它是两者中唯一耗时有上界的：每次投递都带
  // AbortSignal.timeout，最坏 BRIEFING_TELEGRAM_BUDGET_MS 就返回；而
  // sendToSubscriptions 对单个端点没有超时（见下面那段注释），一个慢的 FCM
  // 端点足以把函数拖到被平台掐断。让无上界的那个跑在后面，它最多饿死自己。
  //
  // 没有目标就什么都不发——这个功能默认关闭，要管理员在后台勾选目标才生效。
  // force 重跑会再推一条：那是操作者显式点了「重新生成」，文章本身也换了。
  try {
    const remaining = deadlineMs - Date.now();
    if (remaining < BRIEFING_TELEGRAM_BUDGET_MS) {
      trace(diag, `剩余预算 ${Math.max(0, remaining)}ms 不足，跳过 Telegram 早报推送`);
    } else {
      const outcome = await pushBriefingToTelegram(slug, title);
      if (outcome.skippedReason) {
        // 只记诊断、不告警：没配目标是一种配置状态，不是故障。
        trace(diag, `Telegram 早报推送跳过（${outcome.skippedReason}）`);
      } else {
        const failed = outcome.results.filter((r) => !r.ok);
        trace(
          diag,
          `Telegram 早报推送：${outcome.results.length - failed.length}/${outcome.results.length} 个目标成功` +
            (failed.length > 0
              ? `；失败 ${failed.map((r) => `${r.label}: ${r.error ?? "unknown"}`).join("; ")}`
              : "")
        );
        // 逐目标的失败已经写进 telegram_push_log 与目标健康状态（见
        // deliverToTargets），这里只补一条应用日志，方便和 cron 调用对上时间。
        if (failed.length > 0) console.error("[daily-briefing] telegram push partial failure", failed);
      }
    }
  } catch (err) {
    // 与 Web Push 同一条原则：推送失败不该让已经发布成功的文章被判为失败。
    console.error("[daily-briefing] telegram push failed", err);
  }

  // ⑦ Web Push（默认关闭）。剩余预算不足时整体跳过：文章与心跳都已落定，
  // 推送是唯一可以无损放弃的步骤，明天的稿子照常触发新的推送。
  try {
    if (deadlineMs - Date.now() < 3_000) {
      trace(diag, "剩余预算不足 3 秒，跳过 Web 推送");
      return result;
    }
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

  return result;
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
    // skipped（窗口外 / 今天已有稿）**不写诊断记录**。这两条早退路径带着空的
    // reasons，写进去会把真正干过活的那次运行的原因清掉——而覆盖它的往往
    // 恰恰是操作者点「立即生成」想去查原因的那一下，或一次匿名 tick。
    // 成功/兜底路径在 runPipeline 里已于推送前记录过，这里的重复 upsert
    // 内容相同、幂等无害，保留是为了兜住「推送途中被平台掐断」的窗口。
    if (withReasons.status !== "skipped") {
      await recordLastRun(withReasons);
    }
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
