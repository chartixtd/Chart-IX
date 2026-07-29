"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { TradingLimitRow } from "./page";

function toFieldString(v: number | null): string {
  return v === null || v === undefined ? "" : String(v);
}

function toSymbolsString(v: string[] | null): string {
  return v && v.length ? v.join(",") : "";
}

interface GlobalFormState {
  maxNotionalPerOrder: string;
  maxOrdersPerDay: string;
  maxLeverage: string;
  allowedSymbols: string;
}

function rowToForm(row: TradingLimitRow | undefined): GlobalFormState {
  return {
    maxNotionalPerOrder: toFieldString(row?.max_notional_per_order ?? null),
    maxOrdersPerDay: toFieldString(row?.max_orders_per_day ?? null),
    maxLeverage: toFieldString(row?.max_leverage ?? null),
    allowedSymbols: toSymbolsString(row?.allowed_symbols ?? null),
  };
}

export function TradingLimitsEditor({ rows }: { rows: TradingLimitRow[] }) {
  const router = useRouter();
  const t = useTranslations("admin");
  const { toast } = useToast();

  const globalRow = rows.find((r) => r.user_id === null);
  const overrides = rows.filter((r) => r.user_id !== null);

  const [form, setForm] = useState<GlobalFormState>(() => rowToForm(globalRow));
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleChange = (field: keyof GlobalFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveGlobal = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/trading-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: null,
          maxNotionalPerOrder: form.maxNotionalPerOrder,
          maxOrdersPerDay: form.maxOrdersPerDay,
          maxLeverage: form.maxLeverage,
          allowedSymbols: form.allowedSymbols,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast(t("trading_limits_list.save_success"), "success");
        // Reflect exactly what the server persisted (e.g. blank -> null) rather
        // than trusting the still-raw local input state.
        setForm(rowToForm(data.data as TradingLimitRow));
        router.refresh();
      } else {
        toast(data?.error ?? t("trading_limits_list.save_failed"), "error");
      }
    } catch {
      toast(t("trading_limits_list.save_failed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(
        `/api/admin/trading-limits?id=${encodeURIComponent(deleteTarget)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast(t("trading_limits_list.delete_success"), "success");
        router.refresh();
      } else {
        toast(data?.error ?? t("trading_limits_list.delete_failed"), "error");
      }
    } catch {
      toast(t("trading_limits_list.delete_failed"), "error");
    } finally {
      setDeleteLoading(false);
      setDeleteTarget(null);
    }
  };

  const fmtLimit = (v: number | null) =>
    v === null || v === undefined ? t("trading_limits_list.unlimited") : String(v);
  const fmtSymbols = (v: string[] | null) =>
    v && v.length ? v.join(", ") : t("trading_limits_list.unlimited");

  return (
    <div className="space-y-6">
      <Card padding="md">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          {t("trading_limits_list.global_title")}
        </h2>
        <p className="mb-4 text-xs text-text-muted">{t("trading_limits_list.global_desc")}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("trading_limits_list.max_notional")}
            </label>
            <input
              type="number"
              min={0}
              value={form.maxNotionalPerOrder}
              onChange={(e) => handleChange("maxNotionalPerOrder", e.target.value)}
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              {t("trading_limits_list.blank_unlimited")}
            </p>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("trading_limits_list.max_orders_per_day")}
            </label>
            <input
              type="number"
              min={0}
              value={form.maxOrdersPerDay}
              onChange={(e) => handleChange("maxOrdersPerDay", e.target.value)}
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              {t("trading_limits_list.blank_unlimited")}
            </p>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("trading_limits_list.max_leverage")}
            </label>
            <input
              type="number"
              min={0}
              value={form.maxLeverage}
              onChange={(e) => handleChange("maxLeverage", e.target.value)}
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              {t("trading_limits_list.blank_unlimited")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {t("trading_limits_list.leverage_note")}
            </p>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("trading_limits_list.allowed_symbols")}
            </label>
            <input
              type="text"
              value={form.allowedSymbols}
              onChange={(e) => handleChange("allowedSymbols", e.target.value)}
              placeholder="BTC-USDT,ETH-USDT"
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              {t("trading_limits_list.symbols_hint")} · {t("trading_limits_list.blank_unlimited")}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Button variant="primary" size="sm" loading={saving} onClick={saveGlobal}>
            {t("trading_limits_list.save")}
          </Button>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">
          {t("trading_limits_list.overrides_title")}
        </h2>

        {overrides.length === 0 && (
          <p className="text-center text-text-muted">{t("trading_limits_list.no_overrides")}</p>
        )}

        <div className="space-y-3">
          {overrides.map((row) => (
            <Card key={row.id} padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 text-sm">
                  <div className="mb-2">
                    <span className="text-xs text-text-muted">
                      {t("trading_limits_list.user_id")}:{" "}
                    </span>
                    <code className="text-xs font-mono text-gold bg-gold/10 px-2 py-0.5 rounded">
                      {row.user_id}
                    </code>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-secondary">
                    <div>
                      {t("trading_limits_list.max_notional")}:{" "}
                      <span className="text-text-primary">
                        {fmtLimit(row.max_notional_per_order)}
                      </span>
                    </div>
                    <div>
                      {t("trading_limits_list.max_orders_per_day")}:{" "}
                      <span className="text-text-primary">
                        {fmtLimit(row.max_orders_per_day)}
                      </span>
                    </div>
                    <div>
                      {t("trading_limits_list.max_leverage")}:{" "}
                      <span className="text-text-primary">{fmtLimit(row.max_leverage)}</span>
                    </div>
                    <div>
                      {t("trading_limits_list.allowed_symbols")}:{" "}
                      <span className="text-text-primary">
                        {fmtSymbols(row.allowed_symbols)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    {t("trading_limits_list.updated")}: {new Date(row.updated_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setDeleteTarget(row.id)}
                >
                  {t("trading_limits_list.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
        title={t("trading_limits_list.delete_confirm_title")}
        message={t("trading_limits_list.delete_confirm")}
        confirmText={t("trading_limits_list.delete_confirm_button")}
        cancelText={t("trading_limits_list.cancel")}
        loading={deleteLoading}
        variant="danger"
      />
    </div>
  );
}
