import { NextRequest, NextResponse } from "next/server";
import { retryUndeliveredBriefingLink } from "@/lib/briefing/telegram";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { authorizeCronTick } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB_NAME = "telegram-push";

/*
 * T25 之后这条 cron 只剩一件事：**补投早报链接**。
 *
 * 它原先的主职责是「每隔 N 分钟把扫描器榜单推到 Telegram」。榜单推送已删除，
 * scanner 改成「扫描出新警报卡就推」，触发点搬到了 screener-scan 路由——
 * 只有那里知道哪些卡片是当轮新出现的（见那边的注释）。
 *
 * 这条 tick 没有跟着一起删，是因为补投需要一个**高频心跳**：早报流水线一天
 * 只被触发一次，它那一次投递失败就是永久失败（线上真发生过：生成偏慢，投递
 * 被预算门槛跳过，文章发了、链接没发）。10 分钟一跳正是「漏掉的一轮由下一轮
 * 补上」需要的东西，而 screener-scan 那条 5 分钟的 tick 语义上不该管早报。
 *
 * Auth: CRON_SECRET bypasses throttling; anonymous ticks are rate-limited —
 * see cron-auth.ts for why anonymous ticks are safe here.
 */

/** Heartbeat so "nothing is arriving" is distinguishable from "the job stopped running". */
async function beat(status: "ok" | "error") {
  try {
    await createServiceRoleClient()
      .from("cron_heartbeats")
      .upsert(
        { job_name: JOB_NAME, last_run_at: new Date().toISOString(), last_status: status },
        { onConflict: "job_name" }
      );
  } catch (err) {
    console.error("[cron/telegram-push] heartbeat failed", err);
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCronTick(request.headers.get("authorization"), JOB_NAME);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Too many ticks", retryAfterMs: auth.retryAfterMs },
      { status: auth.status }
    );
  }

  try {
    // 收敛条件（只补今天那篇、发成功过就不再发、次数封顶）在函数内部。
    const briefingRetry = await retryUndeliveredBriefingLink();

    await beat("ok");
    return NextResponse.json({ success: true, briefingRetry });
  } catch (error) {
    console.error("[cron/telegram-push]", error);
    await beat("error");
    // Non-2xx so the failure is visible in the cron invocation log. pg_cron
    // doesn't retry, but the next tick will try the retry again.
    return NextResponse.json({ success: false, error: "Briefing link retry failed" }, { status: 500 });
  }
}
