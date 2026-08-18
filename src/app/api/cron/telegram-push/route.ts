import { NextRequest, NextResponse } from "next/server";
import { getScannerPayload } from "@/lib/screener/cache";
import {
  getTelegramPushSettings,
  isPushDue,
  pushScreenerToTelegram,
} from "@/lib/telegram-push";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildScreenerMessage } from "@/lib/push/messages";
import { retryUndeliveredBriefingLink } from "@/lib/briefing/telegram";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { authorizeCronTick } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB_NAME = "telegram-push";

/**
 * The screener pipeline can take tens of seconds on a cold cache (hundreds of
 * upstream BingX requests at concurrency 8). Left unbounded it could consume
 * the whole 60s budget and the function would die *before ever reaching
 * Telegram* — which is one of the ways pushes silently stopped. Cap it so a
 * slow screener costs us this run's data, not this run's push.
 */
const SCREENER_BUDGET_MS = 30_000;

/*
 * Ticked by external schedulers (GitHub Actions every 10 min, Vercel Cron daily
 * backstop, optionally Supabase pg_cron — see supabase/migrations/036). Ticks
 * far more often than the push interval; whether a push actually goes out is
 * decided by isPushDue against the admin-configured interval, so a tick lost to
 * a timeout is recovered by the next one instead of costing a whole interval.
 * Auth: CRON_SECRET bypasses throttling; anonymous ticks are rate-limited —
 * see cron-auth.ts for why anonymous ticks are safe here.
 */

/** Heartbeat so "nothing is arriving" is distinguishable from "the job stopped running". */
async function beat(status: "ok" | "error" | "skipped") {
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
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
    // Cheap check first: reading one settings row costs nothing, and on most
    // ticks the answer is "not due yet", so we skip the expensive screener
    // computation entirely.
    const settings = await getTelegramPushSettings();
    const due = settings.enabled && isPushDue(settings.lastPushedAt, settings.pushIntervalMinutes);

    // 早报链接的补投挂在这个 tick 上，**在 not_due 早退之前**。
    //
    // 早报流水线一天只被触发一次（vercel.json 的 `0 1 * * *`），所以它那一次
    // 投递失败就是永久失败——线上真发生过：生成偏慢，投递被预算门槛跳过，
    // 文章发了、链接没发，没有任何机制会再试。而这个 tick 每 10 分钟就有一次，
    // 正是本项目已有的那条原则「漏掉的一轮由下一轮补上」需要的心跳。
    //
    // 放在早退之前，是因为绝大多数 tick 都是 not_due；放在后面等于只有
    // 每 4 小时一次的推送窗口才补，补投就失去了意义。
    // 收敛条件（只补今天那篇、发成功过就不再发、次数封顶）在函数内部。
    const briefingRetry = await retryUndeliveredBriefingLink().catch((err) => {
      // 补投失败绝不能影响榜单推送——它才是这个路由的主职责
      console.error("[cron/telegram-push] briefing link retry failed", err);
      return null;
    });

    if (!due) {
      await beat("skipped");
      return NextResponse.json({
        success: true,
        skipped: settings.enabled ? "not_due" : "disabled",
        lastPushedAt: settings.lastPushedAt,
        briefingRetry,
      });
    }

    const payload = await withTimeout(getScannerPayload(), SCREENER_BUDGET_MS, "screener");
    const outcome = await pushScreenerToTelegram(payload);

    // Same call also fans out Web Push, but only to users who opted in.
    // Its failure must not mark the Telegram push as failed.
    try {
      const subscriptions = await getOptedInSubscriptions("screener");
      await Promise.all(
        subscriptions.map((row) => {
          const message = buildScreenerMessage(row.locale);
          return sendToSubscriptions([row], {
            ...message,
            url: `/${row.locale}/screener`,
            tag: "screener",
          });
        })
      );
    } catch (err) {
      console.error("[cron/telegram-push] web push fan-out failed", err);
    }

    // A run where every target failed is a real failure worth surfacing in the
    // heartbeat, even though we return 200 (the job itself ran fine).
    //
    // A `skippedReason` is *not* such a failure: since destinations pick which
    // content they receive, "no target wants the screener" is now a legitimate
    // setup (a briefing-only install). Reporting that as `error` would park the
    // heartbeat on a permanent red that nobody can clear — and a heartbeat
    // that is always red tells you exactly as little as one that is always green.
    if (outcome.skippedReason) await beat("skipped");
    else await beat(outcome.delivered ? "ok" : "error");

    if (!outcome.delivered && !outcome.skippedReason) {
      console.error(
        "[cron/telegram-push] no target accepted the message",
        outcome.skippedReason ?? outcome.results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.error}`)
      );
    }

    return NextResponse.json({
      success: true,
      delivered: outcome.delivered,
      skipped: outcome.skippedReason,
      briefingRetry,
      targets: outcome.results.map((r) => ({
        label: r.label,
        ok: r.ok,
        attempts: r.attempts,
        durationMs: r.durationMs,
      })),
    });
  } catch (error) {
    console.error("[cron/telegram-push]", error);
    await beat("error");
    // Non-2xx so the failure is visible in the cron invocation log. pg_cron
    // doesn't retry, but the next tick will re-evaluate isPushDue and try again.
    return NextResponse.json({ success: false, error: "Screener push failed" }, { status: 500 });
  }
}
