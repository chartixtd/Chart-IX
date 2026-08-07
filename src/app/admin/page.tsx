import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { AdminDashboardClient, type DashboardData } from "@/components/admin/AdminDashboardClient";

export const dynamic = "force-dynamic";

/**
 * 后台首页。
 *
 * 原先只有 5 张卡片，且全部查 users 一张表——「今日新增」「已禁用」在实际数据量下
 * 几乎恒为 0，整页的信息量约等于一个总用户数。现在补上三类真正需要盯的：
 * 内容存量（哪些模块是空的）、运营活跃度、以及系统健康（推送还活着没有）。
 * 后两类是出问题时第一个该看的地方，之前在后台完全看不到。
 */

const DAY_MS = 86_400_000;

export default async function AdminDashboard() {
  const client = createServiceRoleClient();
  const since24h = new Date(Date.now() - DAY_MS).toISOString();
  const since7d = new Date(Date.now() - 7 * DAY_MS).toISOString();

  const count = (table: string) =>
    client.from(table).select("id", { count: "exact", head: true });

  const [
    usersTotal, usersFree, usersPro, usersToday, usersDisabled,
    videosTotal, articlesTotal, articlesPublished, pathsTotal, quizzesTotal,
    ordersTotal, orders7d, paperOrders, communityPosts,
    pushSettings, heartbeat, recentLogs,
  ] = await Promise.all([
    count("users"),
    count("users").eq("tier", "free"),
    count("users").eq("tier", "pro"),
    count("users").gte("created_at", since24h),
    count("users").eq("is_disabled", true),

    count("videos").eq("is_deleted", false),
    count("articles"),
    count("articles").eq("is_published", true),
    count("learning_paths"),
    count("quizzes"),

    count("orders"),
    count("orders").gte("created_at", since7d),
    count("paper_orders").gte("created_at", since7d),
    count("community_posts"),

    client
      .from("telegram_push_settings")
      .select("enabled, last_pushed_at, last_error, consecutive_failures, push_interval_minutes")
      .eq("id", 1)
      .maybeSingle(),
    client
      .from("cron_heartbeats")
      .select("job_name, last_run_at, last_status")
      .eq("job_name", "telegram-push")
      .maybeSingle(),
    client
      .from("admin_logs")
      .select("id, action, target_type, created_at, users:admin_id(email)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const push = pushSettings.data;
  const data: DashboardData = {
    users: {
      total: usersTotal.count ?? 0,
      free: usersFree.count ?? 0,
      pro: usersPro.count ?? 0,
      today: usersToday.count ?? 0,
      disabled: usersDisabled.count ?? 0,
    },
    content: {
      videos: videosTotal.count ?? 0,
      articles: articlesTotal.count ?? 0,
      articlesPublished: articlesPublished.count ?? 0,
      learningPaths: pathsTotal.count ?? 0,
      quizzes: quizzesTotal.count ?? 0,
    },
    activity: {
      ordersTotal: ordersTotal.count ?? 0,
      orders7d: orders7d.count ?? 0,
      paperOrders7d: paperOrders.count ?? 0,
      communityPosts: communityPosts.count ?? 0,
    },
    push: {
      enabled: push?.enabled ?? false,
      lastPushedAt: push?.last_pushed_at ?? null,
      lastError: push?.last_error ?? null,
      consecutiveFailures: push?.consecutive_failures ?? 0,
      intervalMinutes: push?.push_interval_minutes ?? null,
      heartbeatAt: heartbeat.data?.last_run_at ?? null,
      heartbeatStatus: heartbeat.data?.last_status ?? null,
    },
    recentLogs: (recentLogs.data ?? []).map((l) => ({
      id: String(l.id),
      action: l.action as string,
      targetType: (l.target_type as string) ?? "",
      createdAt: l.created_at as string,
      // PostgREST 对嵌套关系返回对象或数组，取决于关系基数推断，两种都兜住
      adminEmail:
        (Array.isArray(l.users) ? l.users[0]?.email : (l.users as { email?: string } | null)?.email) ??
        null,
    })),
  };

  return <AdminDashboardClient data={data} />;
}
