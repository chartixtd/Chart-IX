import { NextRequest, NextResponse } from "next/server";
import { getScreenerPayload } from "@/lib/screener-server";
import {
  getTelegramPushSettings,
  isPushDue,
  pushScreenerToTelegram,
} from "@/lib/telegram-push";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildScreenerMessage } from "@/lib/push/messages";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

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

/**
 * Supabase pg_cron hits this (see supabase/migrations/028_push_cron_jobs.sql).
 * It ticks far more often than the push interval; whether a push actually goes
 * out is decided here by isPushDue against the admin-configured interval, so a
 * tick lost to a timeout is recovered by the next one instead of costing a
 * whole interval.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured locally — allow, matches other unauthenticated dev flows
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

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
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Cheap check first: reading one settings row costs nothing, and on most
    // ticks the answer is "not due yet", so we skip the expensive screener
    // computation entirely.
    const settings = await getTelegramPushSettings();
    const due = settings.enabled && isPushDue(settings.lastPushedAt, settings.pushIntervalMinutes);

    if (!due) {
      await beat("skipped");
      return NextResponse.json({
        success: true,
        skipped: settings.enabled ? "not_due" : "disabled",
        lastPushedAt: settings.lastPushedAt,
      });
    }

    const payload = await withTimeout(getScreenerPayload(), SCREENER_BUDGET_MS, "screener");
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
    await beat(outcome.delivered ? "ok" : "error");

    if (!outcome.delivered) {
      console.error(
        "[cron/telegram-push] no target accepted the message",
        outcome.skippedReason ?? outcome.results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.error}`)
      );
    }

    return NextResponse.json({
      success: true,
      delivered: outcome.delivered,
      skipped: outcome.skippedReason,
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
