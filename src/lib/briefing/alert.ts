import * as Sentry from "@sentry/nextjs";
import { getTelegramPushSettings } from "@/lib/telegram-push";
import { sendTelegramMessage } from "@/lib/telegram-send";

/**
 * 早报降级/失败告警。
 *
 * 静默降级比报错糟糕得多——cron_heartbeats 的注释里记着同一个教训：
 * 「用户以为提醒开着，实际早死了」。任何降级都必须有人知道。
 *
 * Telegram 是可选的：只有配置了 BRIEFING_ALERT_CHAT_ID 才发。刻意**不**复用
 * telegram_push_targets——那些是推给用户的频道，把内部告警发过去是骚扰。
 */
export async function alertBriefing(message: string): Promise<void> {
  console.error(`[daily-briefing] ${message}`);
  Sentry.captureMessage(`daily-briefing: ${message}`, "warning");

  const chatId = process.env.BRIEFING_ALERT_CHAT_ID;
  if (!chatId) return;

  try {
    const settings = await getTelegramPushSettings();
    if (!settings.botToken) return;
    await sendTelegramMessage(settings.botToken, chatId, `⚠️ 每日早报告警\n\n${message}`);
  } catch (err) {
    // 告警本身失败绝不能影响主流程
    console.error("[daily-briefing] telegram alert failed", err);
  }
}
