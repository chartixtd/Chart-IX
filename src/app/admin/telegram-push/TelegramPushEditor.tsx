"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type MessageLang = "en" | "zh";

// Cron fires every 4th UTC hour, minute 0 (see vercel.json). Unix epoch
// (1970-01-01T00:00:00Z) is itself one of those boundaries, so this needs no
// timezone-of-server lookup: just how far `now` sits past the last one.
const PUSH_INTERVAL_MS = 4 * 60 * 60 * 1000;
function msUntilNextScheduledPush(now: number): number {
  return PUSH_INTERVAL_MS - (now % PUSH_INTERVAL_MS);
}
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface PublicSettings {
  enabled: boolean;
  chatId: string | null;
  botTokenConfigured: boolean;
  messageLang: MessageLang;
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

export function TelegramPushEditor({ initial }: { initial: PublicSettings }) {
  const t = useTranslations("admin");
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(initial.enabled);
  const [botToken, setBotToken] = useState("");
  const [botTokenConfigured, setBotTokenConfigured] = useState(initial.botTokenConfigured);
  const [chatId, setChatId] = useState(initial.chatId ?? "");
  const [messageLang, setMessageLang] = useState<MessageLang>(initial.messageLang);
  const [fields, setFields] = useState<Record<FieldKey, boolean>>(() => {
    const f = {} as Record<FieldKey, boolean>;
    for (const { key } of FIELD_TOGGLES) f[key] = initial[key];
    return f;
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushingNow, setPushingNow] = useState(false);
  const [lastPushedAt, setLastPushedAt] = useState(initial.lastPushedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleField = (key: FieldKey) => setFields((prev) => ({ ...prev, [key]: !prev[key] }));

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled,
        chatId,
        messageLang,
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
        toast(data?.error ?? t("telegram_push_list.save_failed"), "error");
      }
    } catch {
      toast(t("telegram_push_list.save_failed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/telegram-push/test", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast(t("telegram_push_list.test_sent"), "success");
      } else {
        toast(data?.error ?? t("telegram_push_list.test_failed"), "error");
      }
    } catch {
      toast(t("telegram_push_list.test_failed"), "error");
    } finally {
      setTesting(false);
    }
  };

  const pushNow = async () => {
    setPushingNow(true);
    try {
      const res = await fetch("/api/admin/telegram-push/push-now", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast(t("telegram_push_list.push_now_sent"), "success");
        setLastPushedAt(data.data.lastPushedAt);
      } else {
        toast(data?.error ?? t("telegram_push_list.push_now_failed"), "error");
      }
    } catch {
      toast(t("telegram_push_list.push_now_failed"), "error");
    } finally {
      setPushingNow(false);
    }
  };

  return (
    <div className="space-y-6">
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
            <label className="block text-xs text-text-secondary mb-1">
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
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">{t("telegram_push_list.bot_token_hint")}</p>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("telegram_push_list.chat_id")}
            </label>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890"
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">{t("telegram_push_list.chat_id_hint")}</p>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t("telegram_push_list.message_lang")}
            </label>
            <select
              value={messageLang}
              onChange={(e) => setMessageLang(e.target.value as MessageLang)}
              className="w-full rounded border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-gold focus:outline-none"
            >
              <option value="en">{t("telegram_push_list.message_lang_en")}</option>
              <option value="zh">{t("telegram_push_list.message_lang_zh")}</option>
            </select>
          </div>

          <p className="text-xs text-text-muted">
            {enabled ? (
              <>
                {t("telegram_push_list.next_push")}: {formatCountdown(msUntilNextScheduledPush(now))}
              </>
            ) : (
              t("telegram_push_list.push_disabled_note")
            )}
            {lastPushedAt && (
              <>
                {" · "}
                {t("telegram_push_list.last_pushed")}: {new Date(lastPushedAt).toLocaleString()}
              </>
            )}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" loading={saving} onClick={save}>
            {t("telegram_push_list.save")}
          </Button>
          <Button variant="outline" size="sm" loading={testing} onClick={sendTest}>
            {t("telegram_push_list.send_test")}
          </Button>
          <Button variant="outline" size="sm" loading={pushingNow} onClick={pushNow}>
            {t("telegram_push_list.push_now")}
          </Button>
        </div>
      </Card>

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
    </div>
  );
}
