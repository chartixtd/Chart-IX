"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

interface FeatureFlag {
  id: number;
  feature_key: string;
  feature_group: string;
  display_name: Record<string, string>;
  description: Record<string, string> | null;
  free_enabled: boolean;
  pro_enabled: boolean;
  updated_at: string;
}

function getDisplayName(names: Record<string, string>): string {
  return names["en-US"] ?? names["zh-CN"] ?? names["ms-MY"] ?? Object.values(names)[0] ?? "-";
}

function getDescription(desc: Record<string, string> | null): string | null {
  if (!desc) return null;
  return desc["en-US"] ?? desc["zh-CN"] ?? desc["ms-MY"] ?? Object.values(desc)[0] ?? null;
}

export function FeaturesTable({ features }: { features: FeatureFlag[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const { toast } = useToast();

  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFeature, setNewFeature] = useState({
    feature_key: "",
    feature_group: "",
    display_name: "",
    description: "",
    free_enabled: false,
    pro_enabled: false,
  });

  const [deleteTarget, setDeleteTarget] = useState<FeatureFlag | null>(null);
  const [deleting, setDeleting] = useState(false);

  const toggleFeature = async (
    feature: FeatureFlag,
    field: "free_enabled" | "pro_enabled"
  ) => {
    const updateKey = `${feature.id}-${field}`;
    const newValue = !feature[field];

    setToggling((prev) => ({ ...prev, [updateKey]: true }));

    const res = await fetch("/api/admin/features", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: feature.id, [field]: newValue }),
    });

    if (res.ok) {
      router.refresh();
    }
    setToggling((prev) => ({ ...prev, [updateKey]: false }));
  };

  const handleCreate = async () => {
    let displayNameObj: Record<string, string> = {};
    let descriptionObj: Record<string, string> | null = null;

    try {
      displayNameObj = JSON.parse(newFeature.display_name);
    } catch {
      toast("Invalid JSON for display_name", "error");
      return;
    }

    if (newFeature.description.trim()) {
      try {
        descriptionObj = JSON.parse(newFeature.description);
      } catch {
        toast("Invalid JSON for description", "error");
        return;
      }
    }

    setCreating(true);
    const res = await fetch("/api/admin/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_key: newFeature.feature_key,
        feature_group: newFeature.feature_group,
        display_name: displayNameObj,
        description: descriptionObj,
        free_enabled: newFeature.free_enabled,
        pro_enabled: newFeature.pro_enabled,
      }),
    });

    if (res.ok) {
      toast(t("features_list.created"), "success");
      setShowCreate(false);
      setNewFeature({
        feature_key: "",
        feature_group: "",
        display_name: "",
        description: "",
        free_enabled: false,
        pro_enabled: false,
      });
      router.refresh();
    } else {
      const data = await res.json();
      toast(data.error ?? "Failed to create feature", "error");
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/features?id=${deleteTarget.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast(t("features_list.deleted"), "success");
      setDeleteTarget(null);
      router.refresh();
    } else {
      const data = await res.json();
      toast(data.error ?? "Failed to delete feature", "error");
    }
    setDeleting(false);
  };

  // Group by feature_group
  const groups = new Map<string, FeatureFlag[]>();
  for (const f of features) {
    const group = f.feature_group || t("features_list.general");
    const list = groups.get(group) ?? [];
    list.push(f);
    groups.set(group, list);
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          {t("features_list.add_feature")}
        </Button>
      </div>

      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            {group}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border-default">
            <table className="w-full text-sm">
              <thead className="bg-bg-tertiary text-left">
                <tr>
                  <th className="px-4 py-3 text-text-muted">{t("features_list.feature_key")}</th>
                  <th className="px-4 py-3 text-text-muted">{t("features_list.display_name")}</th>
                  <th className="px-4 py-3 text-text-muted">{t("features_list.description")}</th>
                  <th className="px-4 py-3 text-text-muted text-center">{t("features_list.free")}</th>
                  <th className="px-4 py-3 text-text-muted text-center">{t("features_list.pro")}</th>
                  <th className="px-4 py-3 text-text-muted" />
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr
                    key={f.id}
                    className="border-t border-border-default hover:bg-bg-tertiary/50"
                  >
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-gold bg-gold/10 px-1.5 py-0.5 rounded">
                        {f.feature_key}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {getDisplayName(f.display_name)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs max-w-[240px] truncate">
                      {getDescription(f.description) ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <label className="relative inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={f.free_enabled}
                          onChange={() => toggleFeature(f, "free_enabled")}
                          className="peer sr-only"
                          disabled={toggling[`${f.id}-free_enabled`]}
                        />
                        <div className="h-5 w-9 rounded-full bg-bg-tertiary border border-border-default peer-checked:bg-success/30 peer-checked:border-success/50 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-text-muted peer-checked:after:bg-success peer-checked:after:translate-x-[calc(2.25rem-1.25rem)] after:transition-all" />
                      </label>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <label className="relative inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={f.pro_enabled}
                          onChange={() => toggleFeature(f, "pro_enabled")}
                          className="peer sr-only"
                          disabled={toggling[`${f.id}-pro_enabled`]}
                        />
                        <div className="h-5 w-9 rounded-full bg-bg-tertiary border border-border-default peer-checked:bg-gold/30 peer-checked:border-gold/50 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-text-muted peer-checked:after:bg-gold peer-checked:after:translate-x-[calc(2.25rem-1.25rem)] after:transition-all" />
                      </label>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(f)}
                        className="text-text-muted hover:text-danger"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {features.length === 0 && (
        <p className="mt-4 text-center text-text-muted">{t("features_list.no_features")}</p>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("features_list.create_feature")}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("features_list.feature_key")}
            </label>
            <input
              type="text"
              value={newFeature.feature_key}
              onChange={(e) => setNewFeature((prev) => ({ ...prev, feature_key: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("features_list.feature_group")}
            </label>
            <input
              type="text"
              value={newFeature.feature_group}
              onChange={(e) => setNewFeature((prev) => ({ ...prev, feature_group: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("features_list.display_name")}
            </label>
            <textarea
              rows={3}
              value={newFeature.display_name}
              placeholder='{"en-US": "My Feature"}'
              onChange={(e) => setNewFeature((prev) => ({ ...prev, display_name: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary font-mono focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("features_list.description")}
            </label>
            <textarea
              rows={2}
              value={newFeature.description}
              placeholder='{"en-US": "Optional description"}'
              onChange={(e) => setNewFeature((prev) => ({ ...prev, description: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary font-mono focus:border-gold focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newFeature.free_enabled}
                onChange={(e) => setNewFeature((prev) => ({ ...prev, free_enabled: e.target.checked }))}
                className="rounded border-border-default"
              />
              <span className="text-sm text-text-primary">{t("features_list.free")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newFeature.pro_enabled}
                onChange={(e) => setNewFeature((prev) => ({ ...prev, pro_enabled: e.target.checked }))}
                className="rounded border-border-default"
              />
              <span className="text-sm text-text-primary">{t("features_list.pro")}</span>
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} loading={creating}>
              {t("features_list.create")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t("features_list.delete_feature")}
        message={t("features_list.delete_confirm")}
        confirmText={t("features_list.delete_feature")}
        cancelText="Cancel"
        loading={deleting}
        variant="danger"
      />
    </div>
  );
}
