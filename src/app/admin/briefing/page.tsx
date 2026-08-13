import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { utcPlus8DateString, utcPlus8Hour, briefingSlug } from "@/lib/briefing/date";
import { PUBLISH_HOUR_START, PUBLISH_HOUR_END } from "@/lib/briefing/run";
import { getTelegramPushSettings, listTargetsFor } from "@/lib/telegram-push";
import { BriefingRunner, type BriefingPageData } from "./BriefingRunner";

export const dynamic = "force-dynamic";

/**
 * 每日早报的测试与巡检页。
 *
 * 存在的理由：这条流水线是无人值守发布的，出问题时最先要回答的三个问题
 * ——「环境变量配齐了没」「定时器还在跑吗」「昨天那篇长什么样」——
 * 在后台原本一个都看不到，只能翻 Vercel 日志和数据库。
 *
 * 页面本身不做任何写操作，「立即生成」走的是 /api/admin/briefing/run-now，
 * 与 cron 完全同一条流水线（只是绕过发布时间窗），所以这里看到的结果
 * 就是线上明早会发生的事。
 */

const RECENT_LIMIT = 10;

interface ArticleRow {
  slug: string;
  title: Record<string, string> | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

export default async function AdminBriefingPage() {
  const client = createServiceRoleClient();
  const now = Date.now();

  const [heartbeatRes, recentRes, pushSettingRes, lastRunRes] = await Promise.all([
    client
      .from("cron_heartbeats")
      .select("last_run_at, last_status")
      .eq("job_name", "daily-briefing")
      .maybeSingle(),
    client
      .from("articles")
      .select("slug, title, is_published, published_at, created_at")
      .like("slug", "daily-briefing-%")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    client
      .from("admin_settings")
      .select("value")
      .eq("key", "daily_briefing_push_enabled")
      .maybeSingle(),
    client
      .from("admin_settings")
      .select("value")
      .eq("key", "daily_briefing_last_run")
      .maybeSingle(),
  ]);

  const hour = utcPlus8Hour(now);
  const todaySlug = briefingSlug(utcPlus8DateString(now));
  const recent = (recentRes.data ?? []) as ArticleRow[];

  // 「早报的链接会发到哪里」是这个页面本来完全答不上来的问题——配置在
  // /admin/telegram-push，而来这里的人是想确认今天的稿子会不会推出去。
  // 读失败只让这块显示「读不到」，绝不能把整个巡检页打成 500。
  let telegram: BriefingPageData["telegram"] = null;
  try {
    const [settings, targets] = await Promise.all([
      getTelegramPushSettings(),
      listTargetsFor("briefing"),
    ]);
    telegram = {
      // 总开关同样管早报——关着的时候目标列表看着很齐全，却一条都发不出去
      enabled: settings.enabled,
      botTokenConfigured: Boolean(settings.botToken),
      targets: targets.map((x) => ({
        label: x.label,
        chatId: x.chatId,
        messageThreadId: x.messageThreadId,
        // 目标自带 token 时，全局 token 缺失对它无所谓
        tokenReady: Boolean(x.botToken || settings.botToken),
      })),
    };
  } catch (err) {
    console.error("[admin/briefing page] telegram targets", err);
  }

  const data: BriefingPageData = {
    // 只暴露"配没配"，绝不把值送到客户端
    env: {
      deepseekKey: Boolean(process.env.DEEPSEEK_API_KEY),
      authorId: Boolean(process.env.BRIEFING_AUTHOR_ID),
      alertChatId: Boolean(process.env.BRIEFING_ALERT_CHAT_ID),
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      fallbackModel: process.env.DEEPSEEK_FALLBACK_MODEL || "deepseek-v4-pro",
    },
    window: {
      hourNow: hour,
      start: PUBLISH_HOUR_START,
      end: PUBLISH_HOUR_END,
      inWindow: hour >= PUBLISH_HOUR_START && hour <= PUBLISH_HOUR_END,
    },
    heartbeat: heartbeatRes.data
      ? {
          lastRunAt: heartbeatRes.data.last_run_at as string,
          lastStatus: heartbeatRes.data.last_status as string,
        }
      : null,
    todaySlug,
    todayPublished: recent.some((a) => a.slug === todaySlug),
    pushEnabled: pushSettingRes.data?.value === true,
    telegram,
    // 上一次运行的降级原因。cron 在无人值守时段跑，等人发现「今天怎么是兜底稿」
    // 时那次响应早没了，所以它必须能从库里读回来。
    lastRun: (lastRunRes.data?.value as BriefingPageData["lastRun"]) ?? null,
    recent: recent.map((a) => ({
      slug: a.slug,
      titleZh: a.title?.["zh-CN"] ?? null,
      titleEn: a.title?.["en-US"] ?? null,
      isPublished: a.is_published,
      publishedAt: a.published_at,
      createdAt: a.created_at,
    })),
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary font-display tracking-tight">每日早报</h1>
      <BriefingRunner data={data} />
    </div>
  );
}
