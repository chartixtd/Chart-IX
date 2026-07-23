"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

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
    </div>
  );
}
