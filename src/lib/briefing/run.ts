import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildContentMessage } from "@/lib/push/messages";
import { translateText } from "@/lib/translate";
import { briefingSlug, utcPlus8DateString } from "@/lib/briefing/date";
import { fetchBriefingSources, MIN_SOURCE_ITEMS } from "@/lib/briefing/sources";
import { fetchMarketFacts } from "@/lib/briefing/market-facts";
import { buildBriefingPrompt } from "@/lib/briefing/prompt";
import { callDeepSeek } from "@/lib/briefing/deepseek";
import { checkBriefing, parseBriefingJson } from "@/lib/briefing/quality-gate";
import { renderBriefingHtml } from "@/lib/briefing/render";
import { fallbackTitle, renderFallbackHtml } from "@/lib/briefing/fallback";
import { alertBriefing as alert } from "@/lib/briefing/alert";
import type { BriefingJson, BriefingLocale, BriefingSource, MarketFact } from "@/lib/briefing/types";

const JOB_NAME = "daily-briefing";
const LOCALES: BriefingLocale[] = ["zh-CN", "en-US"];

export interface BriefingRunResult {
  status: "published" | "fallback" | "skipped" | "failed";
  slug: string;
  detail?: string;
}

/** 心跳：让「没有文章」可以和「任务根本没跑」区分开 */
async function beat(status: "ok" | "error" | "skipped") {
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

/** 生成一语。失败或不过门槛时换备用模型再试一次（降级阶梯 L1/L2） */
async function generateOne(
  locale: BriefingLocale,
  sources: BriefingSource[],
  facts: MarketFact[],
  dateStr: string
): Promise<BriefingJson | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY!;
  const prompt = buildBriefingPrompt(sources, facts, locale, dateStr);
  const models = [
    process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    process.env.DEEPSEEK_MODEL || "deepseek-v4-flash", // L1: 同模型重试一次（空内容是已知偶发问题）
    process.env.DEEPSEEK_FALLBACK_MODEL || "deepseek-v4-pro", // L2: 换模型
  ];

  for (const [attempt, model] of models.entries()) {
    const res = await callDeepSeek({ apiKey, model, prompt });
    if (!res.ok) {
      await alert(`${locale} 第 ${attempt + 1} 次调用失败(${model}): ${res.error}`);
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
    if (gate.ok && parsed) return parsed;
    await alert(
      `${locale} 第 ${attempt + 1} 次未过质量门槛(${model}): ` +
        gate.failures.map((f) => `${f.rule}/${f.detail}`).join("; ")
    );
  }
  return null;
}

async function runPipeline(nowMs: number): Promise<BriefingRunResult> {
  const dateStr = utcPlus8DateString(nowMs);
  const slug = briefingSlug(dateStr);
  const supabase = createServiceRoleClient();

  const authorId = process.env.BRIEFING_AUTHOR_ID;
  if (!process.env.DEEPSEEK_API_KEY || !authorId) {
    await alert("缺少 DEEPSEEK_API_KEY 或 BRIEFING_AUTHOR_ID 环境变量");
    await beat("error");
    return { status: "failed", slug, detail: "missing env" };
  }

  // ① 幂等闸门。真正的并发保护是 articles.slug 的 UNIQUE 约束（见 ⑤），
  //    这次查询只是为了让重复 tick 便宜地早退。
  const { data: existing } = await supabase
    .from("articles")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
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
    await alert("新闻与行情全部获取失败，今日无法出稿");
    await beat("error");
    return { status: "failed", slug, detail: "no material" };
  }

  // ③④ 素材充足才调用模型；否则直接兜底
  const title: Record<string, string> = {};
  const content: Record<string, string> = {};
  let degraded = sources.length < MIN_SOURCE_ITEMS;

  if (degraded) {
    await alert(`24h 内仅 ${sources.length} 条新闻，低于 ${MIN_SOURCE_ITEMS}，直接走兜底稿`);
  } else {
    const [zh, en] = await Promise.all([
      generateOne("zh-CN", sources, facts, dateStr),
      generateOne("en-US", sources, facts, dateStr),
    ]);

    if (zh && en) {
      title["zh-CN"] = zh.title;
      title["en-US"] = en.title;
      content["zh-CN"] = renderBriefingHtml(zh, facts, sources, "zh-CN");
      content["en-US"] = renderBriefingHtml(en, facts, sources, "en-US");
    } else if (zh || en) {
      // L3：两语中恰有一语成功，另一语走翻译通道。
      // en-US 缺失会让英文与马来文读者看到空白正文，绝不能留空。
      const okLocale: BriefingLocale = zh ? "zh-CN" : "en-US";
      const badLocale: BriefingLocale = zh ? "en-US" : "zh-CN";
      const good = (zh ?? en)!;
      const goodHtml = renderBriefingHtml(good, facts, sources, okLocale);
      const from = okLocale === "zh-CN" ? "zh" : "en";
      const to = badLocale === "zh-CN" ? "zh" : "en";

      title[okLocale] = good.title;
      content[okLocale] = goodHtml;
      title[badLocale] = (await translateText(good.title, from, to)) ?? good.title;
      content[badLocale] = (await translateText(goodHtml, from, to)) ?? goodHtml;
      await alert(`${badLocale} 生成失败，已用翻译通道兜住`);
    } else {
      degraded = true;
      await alert("中英两语均未通过质量门槛，改发零 AI 兜底稿");
    }
  }

  // L4：零 AI 兜底稿
  if (degraded) {
    for (const locale of LOCALES) {
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
    await alert(`落库失败: ${insertError.message}`);
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
      for (const sub of subs) {
        const locale = sub.locale === "zh-CN" ? "zh-CN" : "en-US";
        const msg = buildContentMessage(locale, "article", title[locale]);
        await sendToSubscriptions([sub], {
          title: msg.title,
          body: msg.body,
          url: `/${sub.locale}/articles/${slug}`,
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
export async function runDailyBriefing(nowMs: number): Promise<BriefingRunResult> {
  try {
    return await runPipeline(nowMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { scope: "daily-briefing" } });
    await alert(`流水线异常: ${message}`);
    await beat("error");
    return { status: "failed", slug: briefingSlug(utcPlus8DateString(nowMs)), detail: message };
  }
}
