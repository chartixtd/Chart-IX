import { NextRequest, NextResponse } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 唯一在跑的触发器是 `vercel.json` 的 crons：`0 1 * * *`（UTC 01:00 = UTC+8 09:00），
 * 每天一次。**目前没有任何 GitHub Actions step 打这个端点**——cron-tick.yml 里只有
 * telegram-push 与 price-alerts 两步，且那个 workflow 文件根本没被 git 跟踪。
 * 写清楚这一点是因为上一版注释断言"由 cron-tick job 每天打 144 次"，那条接线
 * 从不存在；读起来像是在确认接线已经就位，会让人漏掉"功能整个没在跑"。
 *
 * **发布时间窗仍由 runDailyBriefing 内部的小时闸门决定，不由触发器决定**：
 * 闸门放在流水线里才不依赖外部怎么接线。UTC 01:00 落在 UTC+8 08:00–11:59 窗口内，
 * 所以这条 cron 会真正进入流水线；将来若给 cron-tick.yml 补一个高频 step，
 * 窗口外的 tick 会被同一个闸门挡掉，窗口内的重复 tick 会被幂等闸门挡掉，
 * 无论打多少次都只出一篇。
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
