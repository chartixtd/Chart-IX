"use client";

import { useState, useCallback, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

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

interface UsersTableProps {
  users: User[];
  currentPage: number;
  totalPages: number;
  search: string;
}

export function UsersTable({ users, currentPage, totalPages, search }: UsersTableProps) {
  const t = useTranslations("admin");
  const router = useRouter();
  const { toast } = useToast();

  const [searchValue, setSearchValue] = useState(search);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams();
        if (value) params.set("search", value);
        router.push(`/admin/users?${params.toString()}`);
      }, 300);
    },
    [router]
  );

  const goToPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (page > 1) params.set("page", String(page));
      router.push(`/admin/users?${params.toString()}`);
    },
    [router, search]
  );

  const updateUser = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) {
      toast("User updated", "success");
      router.refresh();
    } else {
      toast("Failed to update user", "error");
    }
  };

  const handleProDateChange = async (userId: string, value: string) => {
    if (!value) {
      await updateUser(userId, { pro_expires_at: null });
    } else {
      await updateUser(userId, { pro_expires_at: value, tier: "pro" });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deleteTarget.id }),
    });
    if (res.ok) {
      toast("User deleted", "success");
      router.refresh();
    } else {
      toast("Failed to delete user", "error");
    }
    setDeleteLoading(false);
    setDeleteTarget(null);
  };

  const handleAddUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setAddLoading(true);

    const body: Record<string, string> = {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      tier: (formData.get("tier") as string) || "free",
      role: (formData.get("role") as string) || "user",
    };
    const dn = formData.get("display_name") as string;
    if (dn) body.display_name = dn;

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      toast("User created", "success");
      setAddModalOpen(false);
      router.refresh();
    } else {
      const data = await res.json();
      toast(data.error || "Failed to create user", "error");
    }
    setAddLoading(false);
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder={t("users_list.search_placeholder")}
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full max-w-sm rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
        />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setAddModalOpen(true)}>
          {t("users_list.add_user")}
        </Button>
      </div>

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
            {users.map((u) => (
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
                    className={u.is_disabled ? "text-danger" : "text-success"}
                  >
                    {u.is_disabled ? t("users_list.yes") : t("users_list.no")}
                  </Button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={u.pro_expires_at ? u.pro_expires_at.split("T")[0] : ""}
                      onChange={(e) => handleProDateChange(u.id, e.target.value)}
                      className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                    />
                    {!u.pro_expires_at && (
                      <span className="inline-flex items-center whitespace-nowrap rounded bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        Permanent
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="red" onClick={() => setDeleteTarget(u)}>
                    {t("users_list.delete_user")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <p className="mt-4 text-center text-text-muted">{t("users_list.no_users")}</p>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            size="sm"
            variant="secondary"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            {t("users_list.prev")}
          </Button>
          <span className="text-sm text-text-secondary">
            {t("users_list.page", { page: currentPage, total: totalPages })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
          >
            {t("users_list.next")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title={t("users_list.delete_user")}
        message={t("users_list.delete_confirm")}
        confirmText={t("users_list.delete_user")}
        cancelText="Cancel"
        loading={deleteLoading}
        variant="danger"
      />

      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title={t("users_list.create_user_modal_title")}
        size="sm"
      >
        <form onSubmit={handleAddUser}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                {t("users_list.email")}
              </label>
              <input
                name="email"
                type="email"
                required
                className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                {t("users_list.password_label")}
              </label>
              <input
                name="password"
                type="password"
                required
                className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                {t("users_list.display_name")}
              </label>
              <input
                name="display_name"
                type="text"
                className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium text-text-primary">
                  {t("users_list.role")}
                </label>
                <select
                  name="role"
                  className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
                >
                  <option value="user">{t("users_list.role_user")}</option>
                  <option value="admin">{t("users_list.role_admin")}</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium text-text-primary">
                  {t("users_list.tier")}
                </label>
                <select
                  name="tier"
                  className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
                >
                  <option value="free">{t("users_list.tier_free")}</option>
                  <option value="pro">{t("users_list.tier_pro")}</option>
                </select>
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAddModalOpen(false)}
              disabled={addLoading}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={addLoading}>
              {t("users_list.create_user")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function UsersPageHeading() {
  const t = useTranslations("admin");
  return <h1 className="mb-6 text-2xl font-bold text-text-primary font-display tracking-tight">{t("users_list.title")}</h1>;
}
