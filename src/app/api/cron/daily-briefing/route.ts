import { NextRequest, NextResponse } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 由 GitHub Actions 的 cron-tick job 每 10 分钟打一次（每天 144 次）。
 *
 * **发布时间窗由 runDailyBriefing 内部的小时闸门决定，不由 workflow 决定**：
 * 给某个 job 再加一条 schedule 并不能限定其中某个 step，所以这个端点每天会被
 * 打满 144 次，其中只有 UTC+8 08:00–11:59 的那些会真正进入流水线。
 * 是否真的出稿再由幂等闸门决定，窗口内打得再频繁也只会出一篇。
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
