import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  getTelegramPushSettings,
  listTargetsFor,
  deliverToTargets,
  escapeHtml,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import { markAlertsPushed } from "./alerts-store";
import { ALERT_TRIGGER_SCORE } from "./types";
import type { NewAlert } from "./alerts";

const SETTINGS_KEY = "screener_alert_push";

export interface AlertPushConfig {
  enabled: boolean;
  /** 只推总分达到这个数的警报。可以调高到 85 只推最强信号。 */
  minScore: number;
}

/**
 * 默认**关闭**。一个新上线的功能不该自己开始往用户的 Telegram 群里发消息——
 * 15 分钟一扫、整池 150 个币，开着不管一天可以推出几十条。
 * 要开就去后台显式打开。
 */
export function parseAlertPushConfig(value: unknown): AlertPushConfig {
  const fallback: AlertPushConfig = { enabled: false, minScore: ALERT_TRIGGER_SCORE };
  if (!value || typeof value !== "object") return fallback;

  const v = value as Record<string, unknown>;
  const enabled = typeof v.enabled === "boolean" ? v.enabled : false;
  const raw = typeof v.minScore === "number" && Number.isFinite(v.minScore) ? v.minScore : ALERT_TRIGGER_SCORE;

  return {
    enabled,
    // 低于触发线是无意义的设置：低于 80 分的币根本不会产生警报，
    // 把它抬回触发线，免得后台看着像"我已经调到 50 了怎么还是这么少"。
    minScore: Math.max(ALERT_TRIGGER_SCORE, raw),
  };
}

export async function getAlertPushConfig(): Promise<AlertPushConfig> {
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("admin_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    return parseAlertPushConfig((data as { value?: unknown } | null)?.value ?? null);
  } catch {
    // 读不到配置一律当成关闭：宁可漏推，也不要因为一次 DB 抖动
    // 就按默认值开始往群里发消息。
    return { enabled: false, minScore: ALERT_TRIGGER_SCORE };
  }
}

const STRINGS: Record<TelegramMessageLang, { title: string; long: string; short: string; at: string }> = {
  en: { title: "🚨 Scanner Alert", long: "LONG", short: "SHORT", at: "locked at" },
  zh: { title: "🚨 扫描器警报", long: "做多", short: "做空", at: "锁定价" },
};

/**
 * 多条警报合并成**一条**消息。一轮扫描同时触发五六个币是常有的事，
 * 一条一发就是刷屏，而 Telegram 对同一个 chat 的连发也有速率限制。
 */
export function formatAlertMessage(alerts: NewAlert[], lang: TelegramMessageLang): string {
  const s = STRINGS[lang];
  const lines = alerts.map((a) => {
    const dir = a.direction === "long" ? s.long : s.short;
    const coin = escapeHtml(a.symbol.replace(/-USDT$/, ""));
    const f = a.factors;
    return (
      `<b>${coin}</b> ${dir} · ${a.triggerScore}/100 · ` +
      `Z${f.zone}/S${f.sweep}/OI${f.oi}/CVD${f.cvd} · ` +
      `${s.at} ${a.triggerPrice}`
    );
  });
  return `${s.title}\n\n${lines.join("\n")}`;
}

/**
 * 推送新触发的警报。返回实际推送的条数。
 *
 * 只接 Telegram，不接 web-push：现有 web-push 的语义是「用户自己设的
 * 某个币的价格提醒」，是用户主动订阅的。把全站扫描器的警报塞进同一个
 * 通道，等于给所有订阅过价格提醒的人推他们从没要求过的东西。
 * 要接的话应该是一个独立的订阅开关，那是另一个功能。
 */
export async function pushNewAlerts(alerts: NewAlert[]): Promise<number> {
  if (alerts.length === 0) return 0;

  const config = await getAlertPushConfig();
  if (!config.enabled) return 0;

  const worth = alerts.filter((a) => a.triggerScore >= config.minScore);
  if (worth.length === 0) return 0;

  const settings = await getTelegramPushSettings();
  const targets = await listTargetsFor("screener");
  if (targets.length === 0) return 0;
  if (!settings.botToken && targets.every((t) => !t.botToken)) return 0;

  const results = await deliverToTargets(
    settings,
    targets,
    (lang) => formatAlertMessage(worth, lang),
    "cron"
  );

  if (!results.some((r) => r.ok)) return 0;

  await markAlertsPushed(worth.map((a) => a.symbol));
  return worth.length;
}
