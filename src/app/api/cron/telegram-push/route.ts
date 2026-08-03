import { NextRequest, NextResponse } from "next/server";
import { getScreenerPayload } from "@/lib/screener-server";
import { pushScreenerToTelegram } from "@/lib/telegram-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron hits this every 4 hours (see vercel.json). Vercel signs cron
 * requests with `Authorization: Bearer $CRON_SECRET` when that env var is set —
 * mirror it here so nobody else can trigger pushes by guessing the URL.
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured locally — allow, matches other unauthenticated dev flows
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await getScreenerPayload();
    await pushScreenerToTelegram(payload);
    return NextResponse.json({ success: true });
  } catch (error) {
    // Non-2xx so the failure is visible in Vercel's cron invocation logs —
    // Vercel Cron doesn't retry on failure, so there's no retry-storm risk here.
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
