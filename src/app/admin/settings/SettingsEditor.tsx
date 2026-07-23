"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface AdminSetting {
  id: number;
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export function SettingsEditor({ settings }: { settings: AdminSetting[] }) {
  const router = useRouter();
  const t = useTranslations("admin");
  const [editingValues, setEditingValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Add new state
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);

  const getValueString = (setting: AdminSetting): string => {
    if (editingValues[setting.id] !== undefined) return editingValues[setting.id];
    try {
      return JSON.stringify(setting.value, null, 2);
    } catch {
      return String(setting.value);
    }
  };

  const handleValueChange = (id: number, raw: string) => {
    setEditingValues((prev) => ({ ...prev, [id]: raw }));
  };

  const saveSetting = async (setting: AdminSetting) => {
    const raw = editingValues[setting.id] ?? getValueString(setting);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError(t("settings_list.invalid_json", { key: setting.key }));
      return;
    }

    setSaving((prev) => ({ ...prev, [setting.id]: true }));
    setError(null);

    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: setting.id, value: parsed }),
    });

    if (res.ok) {
      setEditingValues((prev) => {
        const next = { ...prev };
        delete next[setting.id];
        return next;
      });
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error ?? t("settings_list.save_failed"));
    }
    setSaving((prev) => ({ ...prev, [setting.id]: false }));
  };

  const deleteSetting = async (id: number) => {
    if (!confirm(t("settings_list.delete_confirm"))) return;
    const res = await fetch("/api/admin/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) router.refresh();
  };

  const addSetting = async () => {
    if (!newKey.trim()) {
      setError(t("settings_list.key_required_error"));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(newValue || "null");
    } catch {
      setError(t("settings_list.value_invalid_json"));
      return;
    }
    setAdding(true);
    setError(null);

    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: newKey.trim(),
        value: parsed,
        description: newDesc.trim() || null,
      }),
    });

    if (res.ok) {
      setShowAdd(false);
      setNewKey("");
      setNewValue("");
      setNewDesc("");
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error ?? t("settings_list.add_failed"));
    }
    setAdding(false);
  };

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {settings.map((setting) => (
          <Card key={setting.id} padding="md">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-sm font-mono text-gold bg-gold/10 px-2 py-0.5 rounded">
                    {setting.key}
                  </code>
                  {setting.description && (
                    <span className="text-xs text-text-muted">
                      - {setting.description}
                    </span>
                  )}
                </div>
                <textarea
                  value={getValueString(setting)}
                  onChange={(e) => handleValueChange(setting.id, e.target.value)}
                  className="w-full min-h-[80px] rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary font-mono focus:border-gold focus:outline-none resize-y"
                  rows={3}
                />
                <p className="mt-1 text-xs text-text-muted">
                  {t("settings_list.updated")}: {new Date(setting.updated_at).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-7">
                <Button
                  variant="primary"
                  size="sm"
                  loading={saving[setting.id]}
                  onClick={() => saveSetting(setting)}
                >
                  {t("settings_list.save")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => deleteSetting(setting.id)}
                >
                  {t("settings_list.delete")}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {settings.length === 0 && (
        <p className="text-center text-text-muted">{t("settings_list.no_settings")}</p>
      )}

      {/* Add new */}
      {!showAdd ? (
        <div className="mt-6">
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            {t("settings_list.add_setting")}
          </Button>
        </div>
      ) : (
        <Card padding="md" className="mt-6 border-gold/30">
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            {t("settings_list.new_setting")}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t("settings_list.key_required")}
              </label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. site_name"
                className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t("settings_list.value_json")}
              </label>
              <textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder='{"en-US":"My Site"}'
                rows={3}
                className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted focus:border-gold focus:outline-none resize-y"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t("settings_list.description")}
              </label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What this setting does..."
                className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                loading={adding}
                onClick={addSetting}
              >
                {t("settings_list.add")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAdd(false);
                  setNewKey("");
                  setNewValue("");
                  setNewDesc("");
                  setError(null);
                }}
              >
                {t("settings_list.cancel")}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
