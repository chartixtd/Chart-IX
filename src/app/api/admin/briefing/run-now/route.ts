import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 后台「立即生成早报」。沿用 telegram-push/push-now 的模式：复用同一条流水线，
 * 只是把触发方式从 cron tick 换成管理员点击。调试与补发都依赖它。
 *
 * 注意：流水线自带幂等闸门，今天已出过稿会返回 skipped。要重新生成需先在
 * 数据库删掉那篇文章。runDailyBriefing 永不抛出，故此处无需 try/catch。
 *
 * ignoreSchedule=true 绕过 UTC+8 08:00–11:59 的发布时间窗——那个闸门是拦
 * cron tick 的（见 run.ts），管理员在白天点「立即生成」时不该被它挡住，
 * 否则调试与补发都用不了。
 */
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const result = await runDailyBriefing(Date.now(), { ignoreSchedule: true });
  return NextResponse.json({ success: result.status !== "failed", ...result });
}
