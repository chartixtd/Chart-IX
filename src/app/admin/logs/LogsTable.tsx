"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface LogEntry {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string;
  created_at: string;
  users: { email: string } | null;
}

interface Filters {
  action: string;
  q: string;
  from: string;
  to: string;
}

const INPUT_CLASS =
  "rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary " +
  "placeholder:text-text-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/60";

function formatJson(value: Record<string, unknown> | null): string {
  if (!value) return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function LogsTable({
  logs,
  allActions,
  total,
  page,
  pageSize,
  filters,
}: {
  logs: LogEntry[];
  allActions: string[];
  total: number;
  page: number;
  pageSize: number;
  filters: Filters;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState(filters.q);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** 筛选状态存在 URL 里：刷新、后退、分享链接都能复现同一个视图。 */
  const setParams = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    // 改筛选条件必须回到第一页，否则会停在一个新结果集里不存在的页码上
    if (!("page" in patch)) next.delete("page");
    startTransition(() => router.push(`?${next.toString()}`));
  };

  const resetAll = () => {
    setSearchText("");
    startTransition(() => router.push("?"));
  };

  const hasFilters = Boolean(filters.action || filters.q || filters.from || filters.to);

  function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t("logs_list.just_now");
    if (diffMin < 60) return t("logs_list.minutes_ago", { n: diffMin });
    if (diffHr < 24) return t("logs_list.hours_ago", { n: diffHr });
    if (diffDay < 7) return t("logs_list.days_ago", { n: diffDay });
    return date.toLocaleDateString();
  }

  const hasChanges = (log: LogEntry) => log.old_value !== null || log.new_value !== null;

  return (
    <div>
      {/* 筛选栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchText });
          }}
          className="flex items-center gap-2"
        >
          <input
            type="search"
            placeholder={t("logs_list.search_placeholder")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className={cn(INPUT_CLASS, "w-56")}
          />
          <button
            type="submit"
            className="rounded border border-border-default px-3 py-2 text-sm text-text-secondary transition-colors hover:border-gold/60 hover:text-gold"
          >
            {t("logs_list.search")}
          </button>
        </form>

        <select
          value={filters.action}
          onChange={(e) => setParams({ action: e.target.value })}
          className={INPUT_CLASS}
        >
          <option value="">{t("logs_list.all_actions")}</option>
          {allActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={filters.from}
          onChange={(e) => setParams({ from: e.target.value })}
          aria-label={t("logs_list.date_from")}
          className={cn(INPUT_CLASS, "font-mono")}
        />
        <span className="text-xs text-text-muted">—</span>
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setParams({ to: e.target.value })}
          aria-label={t("logs_list.date_to")}
          className={cn(INPUT_CLASS, "font-mono")}
        />

        {hasFilters && (
          <button
            onClick={resetAll}
            className="rounded border border-border-default px-3 py-2 text-sm text-text-muted transition-colors hover:border-danger/60 hover:text-danger"
          >
            {t("logs_list.reset")}
          </button>
        )}

        <button
          onClick={() => startTransition(() => router.refresh())}
          title={t("logs_list.refresh")}
          className="rounded-sm border border-border-default bg-bg-tertiary p-2 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <svg
            className={cn("h-4 w-4", isPending && "animate-spin")}
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

        <span className="ml-auto text-xs text-text-muted tabular-nums">
          {t("logs_list.total_count", { n: total })}
        </span>
      </div>

      {/* 表格 */}
      <div className={cn("overflow-x-auto rounded-lg border border-border-default", isPending && "opacity-60")}>
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 font-medium text-text-muted">{t("logs_list.time")}</th>
              <th className="px-4 py-3 font-medium text-text-muted">{t("logs_list.admin")}</th>
              <th className="px-4 py-3 font-medium text-text-muted">{t("logs_list.action")}</th>
              <th className="px-4 py-3 font-medium text-text-muted">{t("logs_list.target_type")}</th>
              <th className="px-4 py-3 font-medium text-text-muted">{t("logs_list.target_id")}</th>
              <th className="px-4 py-3 font-medium text-text-muted">{t("logs_list.details")}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => [
              <tr key={log.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td
                  className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary"
                  title={new Date(log.created_at).toLocaleString()}
                >
                  {formatTime(log.created_at)}
                </td>
                <td className="px-4 py-3 text-text-primary">{log.users?.email ?? "-"}</td>
                <td className="px-4 py-3 text-text-primary">{log.action}</td>
                <td className="px-4 py-3 text-text-secondary">{log.target_type}</td>
                <td className="max-w-[160px] truncate px-4 py-3 font-mono text-xs text-text-muted">
                  {log.target_id}
                </td>
                <td className="px-4 py-3">
                  {hasChanges(log) ? (
                    <button
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      className="text-xs text-gold hover:underline"
                    >
                      {expandedId === log.id ? t("logs_list.hide") : t("logs_list.view")}
                    </button>
                  ) : (
                    <span className="text-xs text-text-muted">-</span>
                  )}
                </td>
              </tr>,
              expandedId === log.id && hasChanges(log) ? (
                <tr key={`${log.id}-detail`} className="border-t border-border-default bg-bg-tertiary/30">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-text-muted">
                          {t("logs_list.old_value")}
                        </p>
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border-default bg-bg-primary p-2 font-mono text-xs text-text-secondary">
                          {formatJson(log.old_value)}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-text-muted">
                          {t("logs_list.new_value")}
                        </p>
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border-default bg-bg-primary p-2 font-mono text-xs text-success">
                          {formatJson(log.new_value)}
                        </pre>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>

      {logs.length === 0 && <p className="mt-4 text-center text-text-muted">{t("logs_list.no_logs")}</p>}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4 text-sm">
          <button
            onClick={() => setParams({ page: page - 1 })}
            disabled={page <= 1 || isPending}
            className="rounded border border-border-default px-3 py-1 text-text-primary transition-colors hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("logs_list.prev")}
          </button>
          <span className="text-text-muted tabular-nums">
            {t("logs_list.page", { page, total: totalPages })}
          </span>
          <button
            onClick={() => setParams({ page: page + 1 })}
            disabled={page >= totalPages || isPending}
            className="rounded border border-border-default px-3 py-1 text-text-primary transition-colors hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("logs_list.next")}
          </button>
        </div>
      )}
    </div>
  );
}
