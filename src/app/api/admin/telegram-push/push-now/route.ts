import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { getScannerPayload } from "@/lib/screener/cache";
import { pushActiveAlertsNow } from "@/lib/screener/alert-push";

/*
 * POST - 把**当前所有有效的警报卡**立刻推到 Telegram，绕过总开关与节流间隔
 * （手动点一下就是明确的意图）。逐目标返回结果，部分失败看得见。
 *
 * 推的是 cards 而不是 newCards：手动触发时「这一轮有没有新事」通常是 0，
 * 那样点了没反应，按钮就没法用来验证通道是否通。
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const payload = await getScannerPayload();
    const outcome = await pushActiveAlertsNow(payload);

    if (!outcome.delivered && outcome.skippedReason) {
      return NextResponse.json({ error: outcome.skippedReason }, { status: 400 });
    }

    return NextResponse.json({
      success: outcome.delivered,
      data: { pushed: outcome.pushed, held: outcome.held },
    });
  } catch (err) {
    console.error("[admin/telegram-push/push-now]", err);
    return NextResponse.json({ error: "Push failed" }, { status: 500 });
  }
}
