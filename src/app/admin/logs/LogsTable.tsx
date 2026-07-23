"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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

const ITEMS_PER_PAGE = 20;

function formatJson(value: Record<string, unknown> | null): string {
  if (!value) return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function LogsTable({ logs }: { logs: LogEntry[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();

  const filtered = logs.filter((l) => {
    const matchesSearch =
      !searchText ||
      l.action.toLowerCase().includes(searchText.toLowerCase()) ||
      l.target_type.toLowerCase().includes(searchText.toLowerCase());
    const matchesAction = !actionFilter || l.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const hasChanges = (log: LogEntry) =>
    log.old_value !== null || log.new_value !== null;

  function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t("logs_list.just_now");
    if (diffMin < 60) return t("logs_list.minutes_ago", { n: diffMin });
    if (diffHr < 24) return t("logs_list.hours_ago", { n: diffHr });
    if (diffDay < 7) return t("logs_list.days_ago", { n: diffDay });
    return date.toLocaleDateString();
  }

  return (
    <div>
      {/* Search / Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={t("logs_list.search_placeholder")}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setCurrentPage(1);
          }}
          className="w-full max-w-sm rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
        />
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setCurrentPage(1);
          }}
          className="rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary"
        >
          <option value="">{t("logs_list.all_actions")}</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          onClick={() => router.refresh()}
          className="rounded-sm border border-border-default bg-bg-tertiary p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t("logs_list.refresh")}
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

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">{t("logs_list.time")}</th>
              <th className="px-4 py-3 text-text-muted">{t("logs_list.admin")}</th>
              <th className="px-4 py-3 text-text-muted">{t("logs_list.action")}</th>
              <th className="px-4 py-3 text-text-muted">{t("logs_list.target_type")}</th>
              <th className="px-4 py-3 text-text-muted">{t("logs_list.target_id")}</th>
              <th className="px-4 py-3 text-text-muted">{t("logs_list.details")}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((log) => (
              <>
                <tr
                  key={log.id}
                  className="border-t border-border-default hover:bg-bg-tertiary/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary font-mono text-xs">
                    {formatTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    {log.users?.email ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-text-primary">{log.action}</td>
                  <td className="px-4 py-3 text-text-secondary">{log.target_type}</td>
                  <td className="px-4 py-3 text-text-muted font-mono text-xs max-w-[160px] truncate">
                    {log.target_id}
                  </td>
                  <td className="px-4 py-3">
                    {hasChanges(log) ? (
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === log.id ? null : log.id)
                        }
                        className="text-gold text-xs hover:underline"
                      >
                        {expandedId === log.id ? t("logs_list.hide") : t("logs_list.view")}
                      </button>
                    ) : (
                      <span className="text-text-muted text-xs">-</span>
                    )}
                  </td>
                </tr>
                {expandedId === log.id && hasChanges(log) && (
                  <tr key={`${log.id}-detail`} className="border-t border-border-default bg-bg-tertiary/30">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-medium text-text-muted mb-1 uppercase">
                            {t("logs_list.old_value")}
                          </p>
                          <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-y-auto rounded bg-bg-primary p-2 border border-border-default">
                            {formatJson(log.old_value)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-muted mb-1 uppercase">
                            {t("logs_list.new_value")}
                          </p>
                          <pre className="text-xs text-success font-mono whitespace-pre-wrap max-h-48 overflow-y-auto rounded bg-bg-primary p-2 border border-border-default">
                            {formatJson(log.new_value)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4 text-sm">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded border border-border-default px-3 py-1 text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("logs_list.prev")}
          </button>
          <span className="text-text-muted">
            {t("logs_list.page", { page: currentPage, total: totalPages })}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded border border-border-default px-3 py-1 text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("logs_list.next")}
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-text-muted">{t("logs_list.no_logs")}</p>
      )}
    </div>
  );
}
