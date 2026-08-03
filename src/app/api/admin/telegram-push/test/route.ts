import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { getTelegramPushSettings, sendTelegramMessage } from "@/lib/telegram-push";

// POST - Send a one-off test message using the currently saved bot token/chat id,
// so an admin can verify the bot is wired up correctly without waiting for the next cron run.
export async function POST() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const settings = await getTelegramPushSettings();
    if (!settings.botToken || !settings.chatId) {
      return NextResponse.json(
        { error: "Bot token and chat ID must both be saved first" },
        { status: 400 }
      );
    }

    await sendTelegramMessage(
      settings.botToken,
      settings.chatId,
      "✅ Chart-IX 测试消息 — 这条消息说明 Bot 配置正确。"
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
