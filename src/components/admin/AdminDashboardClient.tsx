"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface DashboardData {
  users: { total: number; free: number; pro: number; today: number; disabled: number };
  content: {
    videos: number;
    articles: number;
    articlesPublished: number;
    quizzes: number;
  };
  activity: {
    ordersTotal: number;
    orders7d: number;
    paperOrders7d: number;
    communityPosts: number;
  };
  push: {
    enabled: boolean;
    lastPushedAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    intervalMinutes: number | null;
    heartbeatAt: string | null;
    heartbeatStatus: string | null;
  };
  recentLogs: {
    id: string;
    action: string;
    targetType: string;
    createdAt: string;
    adminEmail: string | null;
  }[];
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function relative(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function Stat({
  label,
  value,
  hint,
  color,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  color?: string;
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs text-text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", color ?? "text-text-primary")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}
    </>
  );

  const className = cn(
    "rounded-lg panel p-4 transition-colors",
    href && "hover:border-gold/40"
  );

  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-secondary font-display tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function AdminDashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const t = useTranslations("admin");
  const { users, content, activity, push, recentLogs } = data;

  // 推送健康度：三态而不是简单的开/关。「开着但连续失败」和「开着且正常」
  // 在后台必须一眼能分开——前者正是这次修好的那个静默故障的样子。
  const pushState = !push.enabled
    ? { label: t("dash.push_disabled"), color: "text-text-muted", dot: "bg-text-muted" }
    : push.consecutiveFailures > 0
      ? { label: t("dash.push_failing"), color: "text-danger", dot: "bg-danger" }
      : { label: t("dash.push_healthy"), color: "text-success", dot: "bg-success" };

  const nextPush =
    push.enabled && push.lastPushedAt && push.intervalMinutes
      ? new Date(new Date(push.lastPushedAt).getTime() + push.intervalMinutes * 60_000)
      : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary font-display tracking-tight">{t("dashboard")}</h1>
        <button
          onClick={() => router.refresh()}
          title={t("refresh")}
          className="rounded-sm border border-border-default bg-bg-tertiary p-2 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 11-2.2-6M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <Section title={t("dash.users_title")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label={t("total_users")} value={users.total} color="text-info" href="/admin/users" />
          <Stat label={t("free_users")} value={users.free} />
          <Stat label={t("pro_users")} value={users.pro} color="text-gold" />
          <Stat label={t("new_today")} value={users.today} color="text-success" />
          <Stat label={t("disabled")} value={users.disabled} color={users.disabled > 0 ? "text-danger" : undefined} />
        </div>
      </Section>

      <Section title={t("dash.content_title")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t("videos")} value={content.videos} href="/admin/videos" />
          <Stat
            label={t("articles")}
            value={content.articles}
            hint={t("dash.published_n", { n: content.articlesPublished })}
            href="/admin/articles"
          />
          <Stat label={t("quizzes")} value={content.quizzes} href="/admin/quizzes" />
        </div>
      </Section>

      <Section title={t("dash.activity_title")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t("dash.orders_total")} value={activity.ordersTotal} />
          <Stat label={t("dash.orders_7d")} value={activity.orders7d} />
          <Stat label={t("dash.paper_orders_7d")} value={activity.paperOrders7d} />
          <Stat label={t("dash.community_posts")} value={activity.communityPosts} />
        </div>
      </Section>

      <Section title={t("dash.health_title")}>
        <div className="rounded-lg panel p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="flex items-center gap-2 text-sm">
              <span className={cn("h-2 w-2 rounded-full", pushState.dot)} />
              <span className={pushState.color}>{pushState.label}</span>
            </span>

            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <div className="flex items-center gap-2">
                <dt className="text-text-muted">{t("dash.last_push")}</dt>
                <dd className="font-mono tabular-nums text-text-primary">
                  {fmtTime(push.lastPushedAt)}
                </dd>
              </div>
              {nextPush && (
                <div className="flex items-center gap-2">
                  <dt className="text-text-muted">{t("dash.next_push")}</dt>
                  <dd className="font-mono tabular-nums text-text-primary">
                    {fmtTime(nextPush.toISOString())}
                  </dd>
                </div>
              )}
              <div className="flex items-center gap-2">
                <dt className="text-text-muted">{t("dash.scheduler")}</dt>
                <dd
                  className={cn(
                    "font-mono tabular-nums",
                    push.heartbeatAt ? "text-text-primary" : "text-danger"
                  )}
                >
                  {push.heartbeatAt
                    ? `${relative(push.heartbeatAt)} · ${push.heartbeatStatus}`
                    : t("dash.scheduler_never")}
                </dd>
              </div>
            </dl>

            <Link
              href="/admin/telegram-push"
              className="ml-auto text-xs text-text-muted transition-colors hover:text-gold"
            >
              {t("dash.manage")} →
            </Link>
          </div>

          {push.lastError && (
            <p className="mt-3 rounded-sm border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
              {push.lastError}
            </p>
          )}
        </div>
      </Section>

      <Section title={t("dash.recent_activity_title")}>
        <div className="rounded-lg panel">
          {recentLogs.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-text-muted">{t("logs_list.no_logs")}</p>
          ) : (
            <ul className="divide-y divide-border-default">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <span className="font-mono text-text-primary">{log.action}</span>
                  {log.targetType && <span className="text-text-muted">{log.targetType}</span>}
                  <span className="ml-auto truncate text-text-muted">{log.adminEmail ?? "—"}</span>
                  <span className="shrink-0 font-mono tabular-nums text-text-muted">
                    {relative(log.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border-default px-4 py-2 text-right">
            <Link href="/admin/logs" className="text-xs text-text-muted transition-colors hover:text-gold">
              {t("dash.view_all_logs")} →
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
