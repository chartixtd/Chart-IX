"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

const USERS_PER_PAGE = 20;

interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  tier: string;
  language: string;
  is_disabled: boolean;
  pro_expires_at: string | null;
  created_at: string;
}

export function UsersTable({ users }: { users: User[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / USERS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * USERS_PER_PAGE;
  const pageUsers = filtered.slice(startIdx, startIdx + USERS_PER_PAGE);

  const updateUser = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) router.refresh();
  };

  const deleteUser = async (id: string) => {
    if (!window.confirm(t("users_list.delete_confirm"))) return;
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) router.refresh();
  };

  return (
    <div>
      <input
        type="text"
        placeholder={t("users_list.search_placeholder")}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        className="mb-4 w-full max-w-sm rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
      />
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">{t("users_list.email")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.display_name")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.role")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.tier")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.is_disabled")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.pro_expires")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.created")}</th>
              <th className="px-4 py-3 text-text-muted">{t("users_list.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {pageUsers.map((u) => (
              <tr key={u.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td className="px-4 py-3 text-text-primary">{u.email}</td>
                <td className="px-4 py-3 text-text-secondary">{u.display_name ?? "-"}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                    className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="user">{t("users_list.role_user")}</option>
                    <option value="admin">{t("users_list.role_admin")}</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.tier}
                    onChange={(e) => updateUser(u.id, { tier: e.target.value })}
                    className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="free">{t("users_list.tier_free")}</option>
                    <option value="pro">{t("users_list.tier_pro")}</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateUser(u.id, { is_disabled: !u.is_disabled })}
                    className={u.is_disabled ? "text-red-400" : "text-green-400"}
                  >
                    {u.is_disabled ? t("users_list.yes") : t("users_list.no")}
                  </Button>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {u.pro_expires_at ? new Date(u.pro_expires_at).toLocaleDateString() : "-"}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await updateUser(u.id, {
                          pro_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
                          tier: "pro",
                        });
                      }}
                      className="text-gold"
                    >
                      {t("users_list.add_30d_pro")}
                    </Button>
                    <Button
                      size="sm"
                      variant="red"
                      onClick={() => deleteUser(u.id)}
                    >
                      {t("users_list.delete_user")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="mt-4 text-center text-text-muted">{t("users_list.no_users")}</p>
      )}
      {filtered.length > 0 && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            size="sm"
            variant="secondary"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("users_list.prev")}
          </Button>
          <span className="text-sm text-text-secondary">
            {t("users_list.page", { page: safePage, total: totalPages })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t("users_list.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function UsersPageHeading() {
  const t = useTranslations("admin");
  return <h1 className="mb-6 text-2xl font-bold text-text-primary">{t("users_list.title")}</h1>;
}
