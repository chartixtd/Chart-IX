import { NextRequest, NextResponse } from "next/server";
import { getScreenerPayload } from "@/lib/screener-server";
import { pushScreenerToTelegram } from "@/lib/telegram-push";
import { getOptedInSubscriptions, sendToSubscriptions } from "@/lib/push/send";
import { buildScreenerMessage } from "@/lib/push/messages";

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

    // 同一次调用顺带发 Web Push。只发给主动开启了选币通知的用户——
    // 一天 6 条不请自来的推送是权限杀手。Push 失败不应影响 Telegram 推送
    // 已成功这件事，所以单独 try/catch，不让它拖垮整个 cron 响应。
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
    } catch {
      // Web Push 广播失败不应导致整个 cron 任务标记为失败
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // Non-2xx so the failure is visible in Vercel's cron invocation logs —
    // Vercel Cron doesn't retry on failure, so there's no retry-storm risk here.
    console.error("[cron/telegram-push]", error);
    return NextResponse.json({ success: false, error: "Screener push failed" }, { status: 500 });
  }
}
