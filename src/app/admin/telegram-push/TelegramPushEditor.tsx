"use client";

import { useMemo, useState } from "react";
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

const LABEL_CLASS = "mb-1 block text-xs text-text-secondary";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Blank draft used by the "add destination" form. */
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
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushingNow, setPushingNow] = useState(false);

  const toggleField = (key: FieldKey) => setFields((prev) => ({ ...prev, [key]: !prev[key] }));

  const errText = (data: { error?: string } | null, fallback: string) => {
    if (data?.error === "duplicate_chat_id") return t("telegram_push_list.duplicate_chat_id");
    if (data?.error === "no_targets") return t("telegram_push_list.no_targets");
    return data?.error ?? fallback;
  };

  // “下次自动推送”按当前生效的间隔估算——这正是这个页面最该回答的问题：
  // 自动推送到底还活着没有、下一条什么时候来。
  const nextPushLabel = useMemo(() => {
    if (!enabled) return "—";
    if (!health.lastPushedAt) return t("telegram_push_list.next_push_due");
    const minutes = Number(interval);
    const base = Number.isFinite(minutes) ? minutes : initialSettings.pushIntervalMinutes;
    const next = new Date(health.lastPushedAt).getTime() + base * 60_000;
    if (!Number.isFinite(next) || next <= Date.now()) return t("telegram_push_list.next_push_due");
    return fmtTime(new Date(next).toISOString());
  }, [enabled, health.lastPushedAt, interval, initialSettings.pushIntervalMinutes, t]);

  // ── Settings ────────────────────────────────────────────
  const patchSettings = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/telegram-push", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok && data?.success, data };
  };

  /** The enable switch saves immediately — flipping it should never require a second click. */
  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    setTogglingEnabled(true);
    try {
      const { ok, data } = await patchSettings({ enabled: next });
      if (!ok) {
        setEnabled(!next);
        toast(errText(data, t("telegram_push_list.save_failed")), "error");
      }
    } catch {
      setEnabled(!next);
      toast(t("telegram_push_list.save_failed"), "error");
    } finally {
      setTogglingEnabled(false);
    }
  };

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

      const { ok, data } = await patchSettings(body);
      if (ok) {
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

  const stats: { label: string; value: string; danger?: boolean }[] = [
    { label: t("telegram_push_list.last_pushed"), value: fmtTime(health.lastPushedAt) },
    { label: t("telegram_push_list.next_push"), value: nextPushLabel },
    { label: t("telegram_push_list.health_last_attempt"), value: fmtTime(health.lastAttemptAt) },
    {
      label: t("telegram_push_list.health_consecutive_failures"),
      value: String(health.consecutiveFailures),
      danger: health.consecutiveFailures > 0,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Status overview ── */}
      <Card tone="data" padding="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={t("telegram_push_list.enabled")}
              disabled={togglingEnabled}
              onClick={toggleEnabled}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-60",
                enabled ? "border-gold/60 bg-gold" : "border-border-default bg-bg-tertiary"
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform duration-200",
                  enabled ? "translate-x-5 bg-bg-primary" : "translate-x-0 bg-text-secondary"
                )}
              />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-text-primary font-display tracking-tight">
                {t("telegram_push_list.enabled")}
              </h2>
              <p className="text-xs text-text-muted">
                {enabled
                  ? t("telegram_push_list.interval_note")
                  : t("telegram_push_list.push_disabled_note")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" loading={testing && !busyTargetId} onClick={() => sendTest()}>
              {t("telegram_push_list.send_test")}
            </Button>
            <Button variant="primary" size="sm" loading={pushingNow} onClick={pushNow}>
              {t("telegram_push_list.push_now")}
            </Button>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {stats.map(({ label, value, danger }) => (
            <div key={label} className="rounded-sm border border-border-default bg-bg-tertiary/60 px-3 py-2.5">
              <dt className="text-[11px] text-text-muted">{label}</dt>
              <dd
                className={cn(
                  "mt-0.5 truncate font-mono text-xs tabular-nums",
                  danger ? "text-danger" : "text-text-primary"
                )}
                title={value}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {health.lastError ? (
          <p className="mt-3 rounded-sm border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
            <span className="font-medium">{t("telegram_push_list.health_last_error")}: </span>
            {health.lastError}
          </p>
        ) : null}

        {failingTargets.length > 0 && (
          <p className="mt-2 text-xs text-danger">
            {failingTargets
              .map((x) => `${x.label} — ${t("telegram_push_list.target_failing", { count: x.consecutiveFailures })}`)
              .join("; ")}
          </p>
        )}
      </Card>

      {/* ── Bot config + message content ── */}
      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card tone="data" padding="md" className="lg:col-span-3">
          <h2 className="mb-1 text-sm font-semibold text-text-primary font-display tracking-tight">
            {t("telegram_push_list.bot_title")}
          </h2>
          <p className="mb-4 text-xs text-text-muted">{t("telegram_push_list.bot_desc")}</p>

          <div className="space-y-4">
            <div>
              <label className={LABEL_CLASS}>{t("telegram_push_list.bot_token")}</label>
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
                <label className={LABEL_CLASS}>{t("telegram_push_list.message_lang")}</label>
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
                <label className={LABEL_CLASS}>{t("telegram_push_list.interval_label")}</label>
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
          </div>

        </Card>

        <Card tone="data" padding="md" className="lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-text-primary font-display tracking-tight">
            {t("telegram_push_list.fields_title")}
          </h2>
          <p className="mb-4 text-xs text-text-muted">{t("telegram_push_list.fields_desc")}</p>

          <div className="flex flex-wrap gap-2">
            {FIELD_TOGGLES.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                aria-pressed={fields[key]}
                onClick={() => toggleField(key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  fields[key]
                    ? "border-gold/60 bg-gold/10 text-gold"
                    : "border-border-default bg-bg-tertiary text-text-secondary hover:border-border-hover hover:text-text-primary"
                )}
              >
                {t(`telegram_push_list.${labelKey}`)}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* 设置区（机器人配置 + 推送内容）共用一个保存动作 */}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" loading={saving} onClick={save}>
          {t("telegram_push_list.save")}
        </Button>
      </div>

      {/* ── Destinations ── */}
      <Card tone="data" padding="md">
        <h2 className="mb-1 text-sm font-semibold text-text-primary font-display tracking-tight">
          {t("telegram_push_list.targets_title")}
        </h2>
        <p className="mb-4 text-xs text-text-muted">{t("telegram_push_list.targets_desc")}</p>

        {targets.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border-default px-3 py-6 text-center text-xs text-text-muted">
            {t("telegram_push_list.target_none")}
          </p>
        ) : (
          <ul className="divide-y divide-border-default border-y border-border-default">
            {targets.map((target) => {
              const dotClass = !target.enabled
                ? "bg-text-muted/40"
                : target.consecutiveFailures > 0
                  ? "bg-danger"
                  : target.lastOkAt
                    ? "bg-success"
                    : "bg-text-muted/40";
              return (
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

                  <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)} />

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

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyTargetId === target.id}
                      onClick={() => sendTest(target.id)}
                    >
                      {t("telegram_push_list.target_test")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyTargetId === target.id}
                      className="hover:text-danger"
                      onClick={() => setConfirmDeleteId(target.id)}
                    >
                      {t("telegram_push_list.target_delete")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Add form */}
        <div className="mt-4 rounded-sm border border-dashed border-border-default p-4">
          <h3 className="mb-3 text-xs font-semibold text-text-primary">
            {t("telegram_push_list.add_target")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>{t("telegram_push_list.target_label")}</label>
              <input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder={t("telegram_push_list.target_label_placeholder")}
                maxLength={80}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>{t("telegram_push_list.target_chat_id")}</label>
              <input
                value={draft.chatId}
                onChange={(e) => setDraft((d) => ({ ...d, chatId: e.target.value }))}
                placeholder="-1001234567890"
                className={cn(INPUT_CLASS, "font-mono")}
              />
              <p className="mt-1 text-xs text-text-muted">{t("telegram_push_list.chat_id_hint")}</p>
            </div>
            <div>
              <label className={LABEL_CLASS}>{t("telegram_push_list.target_lang")}</label>
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
              <label className={LABEL_CLASS}>{t("telegram_push_list.target_token_override")}</label>
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

          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              loading={addingTarget}
              disabled={!draft.label.trim() || !draft.chatId.trim()}
              onClick={addTarget}
            >
              {t("telegram_push_list.target_save")}
            </Button>
          </div>
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
