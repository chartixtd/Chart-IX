"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface PricingConfig {
  id: number;
  plan_type: string;
  price: number;
  original_price: number | null;
  currency: string;
  currency_symbol: string;
  is_active: boolean;
  updated_at: string;
}

export function PricingEditor({ pricing }: { pricing: PricingConfig[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [editing, setEditing] = useState<Record<number, Partial<PricingConfig>>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const getEdit = (item: PricingConfig): Partial<PricingConfig> => ({
    price: item.price,
    original_price: item.original_price,
    currency_symbol: item.currency_symbol,
    is_active: item.is_active,
    ...editing[item.id],
  });

  const handleChange = (
    id: number,
    field: keyof PricingConfig,
    value: string | number | boolean | null
  ) => {
    setEditing((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleSave = async (item: PricingConfig) => {
    const edit = getEdit(item);
    setSaving((prev) => ({ ...prev, [item.id]: true }));
    setError(null);

    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        price: edit.price,
        original_price: edit.original_price,
        currency_symbol: edit.currency_symbol,
        is_active: edit.is_active,
      }),
    });

    if (res.ok) {
      setEditing((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error ?? t("pricing_list.save_failed"));
    }
    setSaving((prev) => ({ ...prev, [item.id]: false }));
  };

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pricing.map((item) => {
          const edit = getEdit(item);
          const isDirty = editing[item.id] !== undefined;

          return (
            <Card key={item.id} padding="md" hover>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary uppercase">
                    {item.plan_type}
                  </h3>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={edit.is_active}
                      onChange={(e) =>
                        handleChange(item.id, "is_active", e.target.checked)
                      }
                      className="peer sr-only"
                    />
                    <div className="h-5 w-9 rounded-full bg-bg-tertiary border border-border-default peer-checked:bg-success/30 peer-checked:border-success/50 transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-text-muted peer-checked:after:bg-success peer-checked:after:translate-x-[calc(2.25rem-1.25rem)] after:transition-all" />
                  </label>
                </div>

                {/* Currency Symbol */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t("pricing_list.currency_symbol")}
                  </label>
                  <input
                    type="text"
                    value={edit.currency_symbol ?? ""}
                    onChange={(e) =>
                      handleChange(item.id, "currency_symbol", e.target.value)
                    }
                    className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
                  />
                </div>

                {/* Price */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t("pricing_list.price")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={edit.price ?? ""}
                    onChange={(e) =>
                      handleChange(item.id, "price", parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
                  />
                </div>

                {/* Original Price */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t("pricing_list.original_price")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={edit.original_price ?? ""}
                    onChange={(e) =>
                      handleChange(
                        item.id,
                        "original_price",
                        e.target.value === "" ? null : parseFloat(e.target.value)
                      )
                    }
                    className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
                  />
                </div>

                <div className="text-xs text-text-muted">
                  {t("pricing_list.currency")}: {item.currency} &middot; {t("pricing_list.updated")}:{" "}
                  {new Date(item.updated_at).toLocaleDateString()}
                </div>

                <div className="pt-1">
                  <Button
                    variant={isDirty ? "primary" : "ghost"}
                    size="sm"
                    loading={saving[item.id]}
                    onClick={() => handleSave(item)}
                    className="w-full"
                  >
                    {isDirty ? t("pricing_list.save_changes") : t("pricing_list.save")}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {pricing.length === 0 && (
        <p className="mt-4 text-center text-text-muted">{t("pricing_list.no_pricing")}</p>
      )}
    </div>
  );
}
