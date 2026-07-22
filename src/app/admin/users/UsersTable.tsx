"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

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
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.display_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const updateUser = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) router.refresh();
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Search by email or name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
      />
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">Email</th>
              <th className="px-4 py-3 text-text-muted">Display Name</th>
              <th className="px-4 py-3 text-text-muted">Role</th>
              <th className="px-4 py-3 text-text-muted">Tier</th>
              <th className="px-4 py-3 text-text-muted">Disabled</th>
              <th className="px-4 py-3 text-text-muted">Pro Expires</th>
              <th className="px-4 py-3 text-text-muted">Created</th>
              <th className="px-4 py-3 text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td className="px-4 py-3 text-text-primary">{u.email}</td>
                <td className="px-4 py-3 text-text-secondary">{u.display_name ?? "-"}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                    className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.tier}
                    onChange={(e) => updateUser(u.id, { tier: e.target.value })}
                    className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant={u.is_disabled ? "ghost" : "ghost"}
                    onClick={() => updateUser(u.id, { is_disabled: !u.is_disabled })}
                    className={u.is_disabled ? "text-red-400" : "text-green-400"}
                  >
                    {u.is_disabled ? "Yes" : "No"}
                  </Button>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {u.pro_expires_at ? new Date(u.pro_expires_at).toLocaleDateString() : "-"}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
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
                    +30d Pro
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="mt-4 text-center text-text-muted">No users found.</p>
      )}
    </div>
  );
}
