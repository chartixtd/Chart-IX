"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";

type MessageLang = "en" | "zh";

interface PublicSettings {
  enabled: boolean;
  chatId: string | null;
  botTokenConfigured: boolean;
  messageLang: MessageLang;
  pushIntervalMinutes: number;
  showPrice: boolean;
  showChange24h: boolean;
  showAmplitude: boolean;
  showMarketCap: boolean;
  showVolume: boolean;
  showOiRatio: boolean;
  showFunding: boolean;
  showScore: boolean;
  showEdge: boolean;
  lastPushedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

interface PublicTarget {
  id: string;
  label: string;
  chatId: string;
  botTokenConfigured: boolean;
  messageLang: MessageLang | null;
  enabled: boolean;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  sortOrder: number;
}

const FIELD_TOGGLES = [
  { key: "showPrice", labelKey: "field_price" },
  { key: "showChange24h", labelKey: "field_change_24h" },
  { key: "showAmplitude", labelKey: "field_amplitude" },
  { key: "showMarketCap", labelKey: "field_market_cap" },
  { key: "showVolume", labelKey: "field_volume" },
  { key: "showOiRatio", labelKey: "field_oi_ratio" },
  { key: "showFunding", labelKey: "field_funding" },
  { key: "showScore", labelKey: "field_score" },
  { key: "showEdge", labelKey: "field_edge" },
] as const;

type FieldKey = (typeof FIELD_TOGGLES)[number]["key"];

const INPUT_CLASS =
  "w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary " +
  "placeholder:text-text-secondary focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/60";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Blank draft used by the "add destination" row. */
function emptyDraft() {
  return { label: "", chatId: "", botToken: "", messageLang: "" as "" | MessageLang, enabled: true };
}

export function TelegramPushEditor({
  initialSettings,
  initialTargets,
}: {
  initialSettings: PublicSettings;
  initialTargets: PublicTarget[];
}) {
  const t = useTranslations("admin");
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [botToken, setBotToken] = useState("");
  const [botTokenConfigured, setBotTokenConfigured] = useState(initialSettings.botTokenConfigured);
  const [messageLang, setMessageLang] = useState<MessageLang>(initialSettings.messageLang);
  const [interval, setIntervalMinutes] = useState(String(initialSettings.pushIntervalMinutes));
  const [fields, setFields] = useState<Record<FieldKey, boolean>>(() => {
    const f = {} as Record<FieldKey, boolean>;
    for (const { key } of FIELD_TOGGLES) f[key] = initialSettings[key];
    return f;
  });
  const [health, setHealth] = useState({
    lastPushedAt: initialSettings.lastPushedAt,
    lastAttemptAt: initialSettings.lastAttemptAt,
    lastError: initialSettings.lastError,
    consecutiveFailures: initialSettings.consecutiveFailures,
  });

  const [targets, setTargets] = useState<PublicTarget[]>(initialTargets);
  const [draft, setDraft] = useState(emptyDraft());
  const [addingTarget, setAddingTarget] = useState(false);
  const [busyTargetId, setBusyTargetId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushingNow, setPushingNow] = useState(false);

  const toggleField = (key: FieldKey) => setFields((prev) => ({ ...prev, [key]: !prev[key] }));

  const errText = (data: { error?: string } | null, fallback: string) => {
    if (data?.error === "duplicate_chat_id") return t("telegram_push_list.duplicate_chat_id");
    if (data?.error === "no_targets") return t("telegram_push_list.no_targets");
    return data?.error ?? fallback;
  };

  // ── Settings ────────────────────────────────────────────
  const save = async () => {
    const minutes = Number(interval);
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 10080) {
      toast(t("telegram_push_list.interval_invalid"), "error");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled,
        messageLang,
        pushIntervalMinutes: minutes,
        ...fields,
      };
      // Only send botToken if the admin actually typed a new one — an empty
      // field means "leave the stored token alone", not "clear it".
      if (botToken.trim()) body.botToken = botToken;

      const res = await fetch("/api/admin/telegram-push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        toast(t("telegram_push_list.save_success"), "success");
        setBotToken("");
        setBotTokenConfigured(data.data.botTokenConfigured);
      } else {
        toast(errText(data, t("telegram_push_list.save_failed")), "error");
      }
    } catch {
      toast(t("telegram_push_list.save_failed"), "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Targets ─────────────────────────────────────────────
  const addTarget = async () => {
    if (!draft.label.trim() || !draft.chatId.trim()) return;
    setAddingTarget(true);
    try {
      const res = await fetch("/api/admin/telegram-push/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draft.label,
          chatId: draft.chatId,
          botToken: draft.botToken || undefined,
          messageLang: draft.messageLang || null,
          enabled: draft.enabled,
          sortOrder: targets.length,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setTargets((prev) => [...prev, data.data]);
        setDraft(emptyDraft());
        toast(t("telegram_push_list.save_success"), "success");
      } else {
        toast(errText(data, t("telegram_push_list.save_failed")), "error");
      }
    } catch {
      toast(t("telegram_push_list.save_failed"), "error");
    } finally {
      setAddingTarget(false);
    }
  };

  const patchTarget = async (id: string, patch: Record<string, unknown>) => {
    setBusyTargetId(id);
    try {
      const res = await fetch("/api/admin/telegram-push/targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setTargets((prev) => prev.map((x) => (x.id === id ? data.data : x)));
      } else {
        toast(errText(data, t("telegram_push_list.save_failed")), "error");
      }
    } catch {
      toast(t("telegram_push_list.save_failed"), "error");
    } finally {
      setBusyTargetId(null);
    }
  };

  const removeTarget = async (id: string) => {
    setBusyTargetId(id);
    try {
      const res = await fetch(`/api/admin/telegram-push/targets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTargets((prev) => prev.filter((x) => x.id !== id));
        setConfirmDeleteId(null);
      } else {
        const data = await res.json().catch(() => null);
        toast(errText(data, t("telegram_push_list.save_failed")), "error");
      }
    } catch {
      toast(t("telegram_push_list.save_failed"), "error");
    } finally {
      setBusyTargetId(null);
    }
  };

  const sendTest = async (targetId?: string) => {
    setTesting(true);
    if (targetId) setBusyTargetId(targetId);
    try {
      const res = await fetch("/api/admin/telegram-push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetId ? { targetId } : {}),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast(t("telegram_push_list.test_sent"), "success");
      } else {
        // Surface which destination actually failed rather than a generic error.
        const failed = (data?.data ?? []).filter((r: { ok: boolean }) => !r.ok);
        const detail = failed.map((r: { label: string; error?: string }) => `${r.label}: ${r.error}`).join("; ");
        toast(detail || errText(data, t("telegram_push_list.test_failed")), "error");
      }
    } catch {
      toast(t("telegram_push_list.test_failed"), "error");
    } finally {
      setTesting(false);
      setBusyTargetId(null);
    }
  };

  const pushNow = async () => {
    setPushingNow(true);
    try {
      const res = await fetch("/api/admin/telegram-push/push-now", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast(t("telegram_push_list.push_now_sent"), "success");
        setHealth((h) => ({ ...h, lastPushedAt: data.data.lastPushedAt, lastError: null, consecutiveFailures: 0 }));
      } else {
        const failed = (data?.data?.targets ?? []).filter((r: { ok: boolean }) => !r.ok);
        const detail = failed.map((r: { label: string; error?: string }) => `${r.label}: ${r.error}`).join("; ");
        toast(detail || errText(data, t("telegram_push_list.push_now_failed")), "error");
      }
    } catch {
      toast(t("telegram_push_list.push_now_failed"), "error");
    } finally {
      setPushingNow(false);
    }
  };

  const failingTargets = targets.filter((x) => x.consecutiveFailures > 0);

  return (
    <div className="space-y-6">
      {/* ── Bot + schedule ── */}
      <Card padding="md">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          {t("telegram_push_list.bot_title")}
        </h2>
        <p className="mb-4 text-xs text-text-muted">{t("telegram_push_list.bot_desc")}</p>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border-default accent-gold"
            />
            {t("telegram_push_list.enabled")}
          </label>

          <div>
            <label className="mb-1 block text-xs text-text-secondary">
              {t("telegram_push_list.bot_token")}
            </label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={
                botTokenConfigured
                  ? t("telegram_push_list.bot_token_configured")
                  : t("telegram_push_list.bot_token_placeholder")
              }
              autoComplete="off"
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-text-muted">{t("telegram_push_list.bot_token_hint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("telegram_push_list.message_lang")}
              </label>
              <select
                value={messageLang}
                onChange={(e) => setMessageLang(e.target.value as MessageLang)}
                className={INPUT_CLASS}
              >
                <option value="en">{t("telegram_push_list.message_lang_en")}</option>
                <option value="zh">{t("telegram_push_list.message_lang_zh")}</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("telegram_push_list.interval_label")}
              </label>
              <input
                type="number"
                min={15}
                max={10080}
                step={5}
                value={interval}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                className={cn(INPUT_CLASS, "font-mono tabular-nums")}
              />
              <p className="mt-1 text-xs text-text-muted">{t("telegram_push_list.interval_hint")}</p>
            </div>
          </div>

          <p className="text-xs text-text-muted">{t("telegram_push_list.interval_note")}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" loading={saving} onClick={save}>
            {t("telegram_push_list.save")}
          </Button>
          <Button variant="outline" size="sm" loading={testing && !busyTargetId} onClick={() => sendTest()}>
            {t("telegram_push_list.send_test")}
          </Button>
          <Button variant="outline" size="sm" loading={pushingNow} onClick={pushNow}>
            {t("telegram_push_list.push_now")}
          </Button>
        </div>
      </Card>

      {/* ── Delivery health ── */}
      <Card padding="md">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          {t("telegram_push_list.health_title")}
        </h2>

        <dl className="mt-3 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3 border-b border-border-default py-1.5">
            <dt className="text-text-muted">{t("telegram_push_list.last_pushed")}</dt>
            <dd className="font-mono tabular-nums text-text-primary">{fmtTime(health.lastPushedAt)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-border-default py-1.5">
            <dt className="text-text-muted">{t("telegram_push_list.health_last_attempt")}</dt>
            <dd className="font-mono tabular-nums text-text-primary">{fmtTime(health.lastAttemptAt)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-border-default py-1.5">
            <dt className="text-text-muted">{t("telegram_push_list.health_consecutive_failures")}</dt>
            <dd
              className={cn(
                "font-mono tabular-nums",
                health.consecutiveFailures > 0 ? "text-danger" : "text-text-primary"
              )}
            >
              {health.consecutiveFailures}
            </dd>
          </div>
        </dl>

        {health.lastError ? (
          <p className="mt-3 rounded-sm border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
            <span className="font-medium">{t("telegram_push_list.health_last_error")}: </span>
            {health.lastError}
          </p>
        ) : (
          <p className="mt-3 text-xs text-text-muted">{t("telegram_push_list.health_all_good")}</p>
        )}

        {failingTargets.length > 0 && (
          <p className="mt-2 text-xs text-danger">
            {failingTargets.map((x) => x.label).join(", ")}
          </p>
        )}
      </Card>

      {/* ── Destinations ── */}
      <Card padding="md">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          {t("telegram_push_list.targets_title")}
        </h2>
        <p className="mb-4 text-xs text-text-muted">{t("telegram_push_list.targets_desc")}</p>

        {targets.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border-default px-3 py-6 text-center text-xs text-text-muted">
            {t("telegram_push_list.target_none")}
          </p>
        ) : (
          <ul className="divide-y divide-border-default border-y border-border-default">
            {targets.map((target) => (
              <li key={target.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={target.enabled}
                    disabled={busyTargetId === target.id}
                    onChange={(e) => patchTarget(target.id, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-border-default accent-gold"
                  />
                  <span className="sr-only">{t("telegram_push_list.target_enabled")}</span>
                </label>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{target.label}</p>
                  <p className="truncate font-mono text-xs text-text-muted">{target.chatId}</p>
                </div>

                <div className="text-right text-xs">
                  {target.consecutiveFailures > 0 ? (
                    <p className="font-medium text-danger">
                      {t("telegram_push_list.target_failing", { count: target.consecutiveFailures })}
                    </p>
                  ) : (
                    <p className="text-text-muted">
                      {target.lastOkAt
                        ? `${t("telegram_push_list.target_last_ok")} ${fmtTime(target.lastOkAt)}`
                        : t("telegram_push_list.target_never_sent")}
                    </p>
                  )}
                  {target.lastError && target.consecutiveFailures > 0 && (
                    <p className="mt-0.5 max-w-xs truncate text-text-muted" title={target.lastError}>
                      {target.lastError}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => sendTest(target.id)}
                    disabled={busyTargetId === target.id}
                    className="text-xs text-text-muted transition-colors hover:text-gold disabled:opacity-50"
                  >
                    {t("telegram_push_list.target_test")}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(target.id)}
                    disabled={busyTargetId === target.id}
                    className="text-xs text-text-muted transition-colors hover:text-danger disabled:opacity-50"
                  >
                    {t("telegram_push_list.target_delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Add form */}
        <div className="mt-4 space-y-3 rounded-sm border border-dashed border-border-default p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("telegram_push_list.target_label")}
              </label>
              <input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder={t("telegram_push_list.target_label_placeholder")}
                maxLength={80}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("telegram_push_list.target_chat_id")}
              </label>
              <input
                value={draft.chatId}
                onChange={(e) => setDraft((d) => ({ ...d, chatId: e.target.value }))}
                placeholder="-1001234567890"
                className={cn(INPUT_CLASS, "font-mono")}
              />
              <p className="mt-1 text-xs text-text-muted">{t("telegram_push_list.chat_id_hint")}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("telegram_push_list.target_lang")}
              </label>
              <select
                value={draft.messageLang}
                onChange={(e) => setDraft((d) => ({ ...d, messageLang: e.target.value as "" | MessageLang }))}
                className={INPUT_CLASS}
              >
                <option value="">{t("telegram_push_list.target_lang_inherit")}</option>
                <option value="en">{t("telegram_push_list.message_lang_en")}</option>
                <option value="zh">{t("telegram_push_list.message_lang_zh")}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("telegram_push_list.target_token_override")}
              </label>
              <input
                type="password"
                value={draft.botToken}
                onChange={(e) => setDraft((d) => ({ ...d, botToken: e.target.value }))}
                autoComplete="off"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-text-muted">
                {t("telegram_push_list.target_token_override_hint")}
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            loading={addingTarget}
            disabled={!draft.label.trim() || !draft.chatId.trim()}
            onClick={addTarget}
          >
            {t("telegram_push_list.add_target")}
          </Button>
        </div>
      </Card>

      {/* ── Message content ── */}
      <Card padding="md">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          {t("telegram_push_list.fields_title")}
        </h2>
        <p className="mb-4 text-xs text-text-muted">{t("telegram_push_list.fields_desc")}</p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FIELD_TOGGLES.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={fields[key]}
                onChange={() => toggleField(key)}
                className="h-4 w-4 rounded border-border-default accent-gold"
              />
              {t(`telegram_push_list.${labelKey}`)}
            </label>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && removeTarget(confirmDeleteId)}
        title={t("telegram_push_list.target_delete")}
        message={t("telegram_push_list.target_delete_confirm")}
        confirmText={t("telegram_push_list.target_delete")}
        loading={busyTargetId !== null && busyTargetId === confirmDeleteId}
      />
    </div>
  );
}
