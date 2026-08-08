import { NextRequest, NextResponse } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 由 GitHub Actions 在 UTC+8 早 08:00–10:30 时间窗内每 30 分钟打一次。
 * 是否真的出稿由 runDailyBriefing 的幂等闸门决定，打得再频繁也只会出一篇。
 *
 * 本文件只做鉴权与转发——流水线主体在 @/lib/briefing/run，因为 Next.js
 * 不允许 route 文件导出 HTTP 处理器以外的东西，而后台手动触发要复用它。
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeCronTick(request.headers.get("authorization"), "daily-briefing");
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(auth.retryAfterMs / 1000)) } }
    );
  }

  const result = await runDailyBriefing(Date.now());
  return NextResponse.json({ success: result.status !== "failed", ...result });
}
