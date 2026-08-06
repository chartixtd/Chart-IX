import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { sendTelegramTest } from "@/lib/telegram-push";

/**
 * POST - Send a one-off test message so an admin can verify the wiring without
 * waiting for the next cron tick. Pass `{ targetId }` to test a single
 * destination, or omit it to test every enabled one.
 *
 * Returns per-target results rather than throwing on the first failure — when
 * three chats are configured and one is broken, the admin needs to see which.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    let targetId: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.targetId === "string" && body.targetId) targetId = body.targetId;
    } catch {
      // No body is fine — means "test everything enabled".
    }

    const results = await sendTelegramTest(targetId);

    return NextResponse.json({
      success: results.some((r) => r.ok),
      data: results.map((r) => ({
        label: r.label,
        ok: r.ok,
        attempts: r.attempts,
        error: r.error,
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "no_targets") {
      return NextResponse.json({ error: "no_targets" }, { status: 400 });
    }
    console.error("[admin/telegram-push/test]", err);
    return NextResponse.json({ error: "Test send failed" }, { status: 500 });
  }
}
