import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { pushScreenerNow } from "@/lib/telegram-push";

// POST - Push the current screener list to Telegram immediately, regardless of the
// 4-hour cron schedule or the `enabled` flag (an explicit click is explicit intent).
export async function POST() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const result = await pushScreenerNow();
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
