import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 后台「立即生成早报」。沿用 telegram-push/push-now 的模式：复用同一条流水线，
 * 只是把触发方式从 cron tick 换成管理员点击。调试与补发都依赖它。
 *
 * ignoreSchedule=true 绕过 UTC+8 08:00–11:59 的发布时间窗——那个闸门是拦
 * cron tick 的（见 run.ts），管理员在白天点「立即生成」时不该被它挡住，
 * 否则调试与补发都用不了。
 *
 * body 里的 force=true 会先删掉今天那篇再重新生成。默认不删：幂等是这条
 * 流水线的核心保证，删除只该发生在人明确要求重跑的时候。
 *
 * runDailyBriefing 永不抛出，故此处无需 try/catch。
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  // body 可以为空（普通触发），解析失败一律当作不强制
  let force = false;
  try {
    const body = (await request.json()) as { force?: unknown };
    force = body?.force === true;
  } catch {
    /* 无 body，force 保持 false */
  }

  const result = await runDailyBriefing(Date.now(), { ignoreSchedule: true, force });
  return NextResponse.json({ success: result.status !== "failed", ...result });
}
