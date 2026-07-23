"use client";

import { useTranslations } from "next-intl";

interface Stats {
  total: number;
  free: number;
  pro: number;
  today: number;
  disabled: number;
}

export function AdminDashboardClient({ stats }: { stats: Stats }) {
  const t = useTranslations("admin");

  const items: { label: string; value: number; color: string }[] = [
    { label: t("total_users"), value: stats.total, color: "text-blue-400" },
    { label: t("free_users"), value: stats.free, color: "text-text-secondary" },
    { label: t("pro_users"), value: stats.pro, color: "text-gold" },
    { label: t("new_today"), value: stats.today, color: "text-green-400" },
    { label: t("disabled"), value: stats.disabled, color: "text-red-400" },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">
        {t("dashboard")}
      </h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {items.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border-default bg-bg-secondary p-4"
          >
            <p className="text-sm text-text-muted">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
