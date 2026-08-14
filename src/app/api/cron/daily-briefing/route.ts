import { NextRequest, NextResponse } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runDailyBriefing } from "@/lib/briefing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 触发器有两个：
 *
 * 1. `vercel.json` 的 crons：`0 1 * * *`（UTC 01:00 = UTC+8 09:00），每天一次。
 * 2. Supabase pg_cron 的 `daily-briefing-tick`（见迁移 047），每 10 分钟一次。
 *
 * 第二个是重试机制的心跳，缺了它这条流水线一天只有一次机会：那次调用无论
 * 是被平台掐断、DeepSeek 全挂、还是只出得了兜底稿，结果都会固化成当天的
 * 最终状态，没有任何东西会再试一次。线上真发生过（投递被预算门槛跳过，
 * 文章发了链接没发）。
 *
 * 高频 tick 之所以安全，全靠流水线自己的三道闸门——**闸门在流水线里，
 * 不在触发器里**，所以接线怎么变都不会破：
 * - 发布时间窗（UTC+8 08:00–11:59）：窗口外的 tick 一天 130+ 次，全部 idle 早退。
 * - 幂等闸门 + articles.slug 唯一约束：窗口内打多少次都只出一篇。
 * - 升级次数上限（publish-state.ts）：兜底稿最多重生成 3 次，不会无限烧模型调用。
 *
 * 注意 **cron-tick.yml 那个 GitHub Actions workflow 从未生效**——它没被 git
 * 跟踪，远端仓库里根本没有这个文件。真正在敲端点的一直是 pg_cron。
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

  // 只有 cron 传 upgradeFallback：今天已经是兜底稿时再生成一次试着升级它。
  // 后台的「立即生成」不传——那里有专门的红色按钮做强制重跑，语义更明确。
  const result = await runDailyBriefing(Date.now(), { upgradeFallback: true });
  return NextResponse.json({ success: result.status !== "failed", ...result });
}
