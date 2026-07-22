"use client";

import { useState } from "react";

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

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatJson(value: Record<string, unknown> | null): string {
  if (!value) return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function LogsTable({ logs }: { logs: LogEntry[] }) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();

  const filtered = logs.filter(
    (l) =>
      (!search || l.action.toLowerCase().includes(search.toLowerCase()) || l.target_type.toLowerCase().includes(search.toLowerCase()))
  );

  const hasChanges = (log: LogEntry) =>
    log.old_value !== null || log.new_value !== null;

  return (
    <div>
      {/* Search / Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by action or target type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
        />
        <select
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary"
        >
          <option value="">All Actions</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">Time</th>
              <th className="px-4 py-3 text-text-muted">Admin</th>
              <th className="px-4 py-3 text-text-muted">Action</th>
              <th className="px-4 py-3 text-text-muted">Target Type</th>
              <th className="px-4 py-3 text-text-muted">Target ID</th>
              <th className="px-4 py-3 text-text-muted">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((log) => (
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
                        {expandedId === log.id ? "Hide" : "View"}
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
                            Old Value
                          </p>
                          <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-y-auto rounded bg-bg-primary p-2 border border-border-default">
                            {formatJson(log.old_value)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-muted mb-1 uppercase">
                            New Value
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

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-text-muted">No logs found.</p>
      )}
    </div>
  );
}
