import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { logAdminAction } from "@/lib/supabase/admin-log";
import {
  getTelegramPushSettings,
  updateTelegramPushSettings,
  type TelegramPushSettings,
} from "@/lib/telegram-push";

/** Strip the decrypted bot token out before it ever reaches JSON.stringify */
function toPublicShape(settings: TelegramPushSettings) {
  const { botToken, ...rest } = settings;
  return { ...rest, botTokenConfigured: Boolean(botToken) };
}

// GET - Return current settings. bot_token is never sent back in full, only whether it's set.
export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const settings = await getTelegramPushSettings();
    return NextResponse.json({ data: toPublicShape(settings) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH - Update settings. `botToken` is optional — omit it to leave the stored token untouched;
// pass an empty string to clear it.
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const settings = await updateTelegramPushSettings(body);

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "update_setting",
        targetType: "setting",
        targetId: "telegram_push",
        oldValue: null,
        // Never log the token itself
        newValue: { ...body, botToken: body.botToken !== undefined ? "[redacted]" : undefined },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, data: toPublicShape(settings) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
