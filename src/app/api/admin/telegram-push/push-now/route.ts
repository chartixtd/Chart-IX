import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { pushScreenerNow } from "@/lib/telegram-push";

// POST - Push the current screener list to Telegram immediately, bypassing both
// the configured interval and the `enabled` flag (an explicit click is explicit
// intent). Reports per-target outcomes so a partial failure is visible.
export async function POST() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const outcome = await pushScreenerNow();

    if (!outcome.delivered && outcome.skippedReason) {
      return NextResponse.json({ error: outcome.skippedReason }, { status: 400 });
    }

    return NextResponse.json({
      success: outcome.delivered,
      data: {
        lastPushedAt: outcome.lastPushedAt,
        targets: outcome.results.map((r) => ({
          label: r.label,
          ok: r.ok,
          attempts: r.attempts,
          error: r.error,
        })),
      },
    });
  } catch (err) {
    console.error("[admin/telegram-push/push-now]", err);
    return NextResponse.json({ error: "Push failed" }, { status: 500 });
  }
}
