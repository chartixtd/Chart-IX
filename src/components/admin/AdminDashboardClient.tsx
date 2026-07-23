"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface Stats {
  total: number;
  free: number;
  pro: number;
  today: number;
  disabled: number;
}

interface AdminDashboardClientProps {
  stats: Stats | undefined;
  isLoading?: boolean;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border-default bg-bg-secondary p-4 animate-pulse">
      <div className="h-4 w-16 rounded bg-bg-tertiary mb-3" />
      <div className="h-8 w-12 rounded bg-bg-tertiary" />
    </div>
  );
}

export function AdminDashboardClient({ stats, isLoading = false }: AdminDashboardClientProps) {
  const router = useRouter();
  const t = useTranslations("admin");

  const baseItems: { label: string; key: keyof Stats; color: string }[] = [
    { label: t("total_users"), key: "total", color: "text-blue-400" },
    { label: t("free_users"), key: "free", color: "text-text-secondary" },
    { label: t("pro_users"), key: "pro", color: "text-gold" },
    { label: t("new_today"), key: "today", color: "text-green-400" },
    { label: t("disabled"), key: "disabled", color: "text-red-400" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">
          {t("dashboard")}
        </h1>
        <button
          onClick={() => router.refresh()}
          className="rounded-sm border border-border-default bg-bg-tertiary p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t("dashboard.refresh")}
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : baseItems.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-border-default bg-bg-secondary p-4"
              >
                <p className="text-sm text-text-muted">{s.label}</p>
                <p className={`mt-1 text-3xl font-bold ${s.color}`}>
                  {stats ? stats[s.key] : "-"}
                </p>
              </div>
            ))}
      </div>
    </div>
  );
}
