"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

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
  const { toast } = useToast();
  const [editing, setEditing] = useState<Record<number, Partial<PricingConfig>>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPlan, setNewPlan] = useState({
    plan_type: "",
    price: 0,
    original_price: null as number | null,
    currency: "USD",
    currency_symbol: "$",
    is_active: false,
  });

  const [deleteTarget, setDeleteTarget] = useState<PricingConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      toast(t("pricing_list.saved"), "success");
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

  const handleCreate = async () => {
    setCreating(true);
    const res = await fetch("/api/admin/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_type: newPlan.plan_type,
        price: newPlan.price,
        original_price: newPlan.original_price,
        currency: newPlan.currency,
        currency_symbol: newPlan.currency_symbol,
        is_active: newPlan.is_active,
      }),
    });

    if (res.ok) {
      toast(t("pricing_list.created"), "success");
      setShowCreate(false);
      setNewPlan({
        plan_type: "",
        price: 0,
        original_price: null,
        currency: "USD",
        currency_symbol: "$",
        is_active: false,
      });
      router.refresh();
    } else {
      const data = await res.json();
      toast(data.error ?? "Failed to create plan", "error");
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/pricing?id=${deleteTarget.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast(t("pricing_list.deleted"), "success");
      setDeleteTarget(null);
      router.refresh();
    } else {
      const data = await res.json();
      toast(data.error ?? "Failed to delete plan", "error");
    }
    setDeleting(false);
  };

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          {t("pricing_list.add_plan")}
        </Button>
      </div>

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

                <div className="flex gap-2 pt-1">
                  <Button
                    variant={isDirty ? "primary" : "ghost"}
                    size="sm"
                    loading={saving[item.id]}
                    onClick={() => handleSave(item)}
                    className="flex-1"
                  >
                    {isDirty ? t("pricing_list.save_changes") : t("pricing_list.save")}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteTarget(item)}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("pricing_list.create_plan")}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("pricing_list.plan_type")}
            </label>
            <input
              type="text"
              value={newPlan.plan_type}
              onChange={(e) => setNewPlan((prev) => ({ ...prev, plan_type: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("pricing_list.plan_price")}
            </label>
            <input
              type="number"
              step="0.01"
              value={newPlan.price}
              onChange={(e) => setNewPlan((prev) => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("pricing_list.plan_original_price")}
            </label>
            <input
              type="number"
              step="0.01"
              value={newPlan.original_price ?? ""}
              onChange={(e) =>
                setNewPlan((prev) => ({
                  ...prev,
                  original_price: e.target.value === "" ? null : parseFloat(e.target.value),
                }))
              }
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("pricing_list.currency")}
            </label>
            <input
              type="text"
              value={newPlan.currency}
              onChange={(e) => setNewPlan((prev) => ({ ...prev, currency: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("pricing_list.currency_symbol")}
            </label>
            <input
              type="text"
              value={newPlan.currency_symbol}
              onChange={(e) => setNewPlan((prev) => ({ ...prev, currency_symbol: e.target.value }))}
              className="w-full rounded border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newPlan.is_active}
                onChange={(e) => setNewPlan((prev) => ({ ...prev, is_active: e.target.checked }))}
                className="rounded border-border-default"
              />
              <span className="text-sm text-text-primary">{t("pricing_list.active")}</span>
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} loading={creating}>
              {t("pricing_list.create")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t("pricing_list.delete_plan")}
        message={t("pricing_list.delete_confirm")}
        confirmText={t("pricing_list.delete_plan")}
        cancelText="Cancel"
        loading={deleting}
        variant="danger"
      />
    </div>
  );
}
