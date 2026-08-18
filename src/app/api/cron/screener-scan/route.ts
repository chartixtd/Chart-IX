import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runScan } from "@/lib/screener/pipeline";
import { isScanDue, writeScannerCache } from "@/lib/screener/cache";
import { planAlerts } from "@/lib/screener/alerts";
import { listOpenAlerts, applyAlertPlan } from "@/lib/screener/alerts-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 一轮完整扫描实测约 22 秒。60 是 Vercel Hobby 的上限，不能再高。
export const maxDuration = 60;

const JOB_NAME = "screener-scan";

export async function GET(request: NextRequest) {
  const auth = await authorizeCronTick(request.headers.get("authorization"), JOB_NAME);
  if (!auth.ok) {
    return NextResponse.json({ error: "Too many ticks", retryAfterMs: auth.retryAfterMs }, { status: auth.status });
  }

  // 提前退出不是优化，是必需：触发器每 5 分钟打一次而扫描间隔是 15 分钟，
  // 三次里有两次应该在这里就走人，只花一次单行 DB 读。
  if (!(await isScanDue())) {
    return NextResponse.json({ skipped: true, reason: "not due" });
  }

  try {
    const payload = await runScan();
    await writeScannerCache(payload);

    const open = await listOpenAlerts();
    const plan = planAlerts(payload.rows, open);
    const opened = await applyAlertPlan(plan);

    return NextResponse.json({
      rows: payload.rows.length,
      opened: opened.length,
      updated: plan.updates.length,
      closed: plan.closes.length,
    });
  } catch (error) {
    console.error("[cron/screener-scan]", error);
    // 500 让调度器把这次 run 记成失败（可见性），下一个 tick 会自愈重试。
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
