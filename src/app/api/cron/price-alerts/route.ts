import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { evaluateAlerts, type PendingAlert } from "@/lib/push/evaluate";
import { buildAlertMessage } from "@/lib/push/messages";
import { sendToSubscriptions, type SubscriptionRow } from "@/lib/push/send";
import { getSpotTickers } from "@/lib/bingx/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB_NAME = "price-alerts";

/** 沿用 telegram-push 的鉴权模式 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 本地未配置时放行，与其他开发流程一致
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // 提前退出不是优化，是必需：Vercel Hobby 每月只有 4 CPU-小时，
  // 每分钟一次是每月 43,200 次调用。绝大多数分钟里没有任何活跃提醒，
  // 一次部分索引查询就该返回。
  const { data: pendingRows, error } = await supabase
    .from("price_alerts")
    .select("id, user_id, symbol, target_price, direction")
    .is("triggered_at", null);

  if (error) {
    await beat(supabase, "error");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pending: PendingAlert[] = (pendingRows ?? []).map((r) => {
    const row = r as { id: string; user_id: string; symbol: string; target_price: number; direction: "above" | "below" };
    return {
      id: row.id,
      userId: row.user_id,
      symbol: row.symbol,
      targetPrice: Number(row.target_price),
      direction: row.direction,
    };
  });

  if (pending.length === 0) {
    await beat(supabase, "ok");
    return NextResponse.json({ checked: 0, triggered: 0 });
  }

  // 一次批量请求拿回全部行情，而不是逐个币种请求
  let prices: Record<string, number> = {};
  try {
    const tickers = await getSpotTickers();
    prices = Object.fromEntries(
      tickers.map((t) => [t.symbol, parseFloat(String(t.lastPrice))])
    );
  } catch {
    // 拿不到行情就跳过这一轮：不标记触发、不发推送。
    // 宁可晚一分钟，不可误判。
    await beat(supabase, "error");
    return NextResponse.json({ checked: pending.length, triggered: 0, skipped: "no-prices" });
  }

  const triggered = evaluateAlerts(pending, prices);
  if (triggered.length === 0) {
    await beat(supabase, "ok");
    return NextResponse.json({ checked: pending.length, triggered: 0 });
  }

  // 幂等：只对真正被这次更新拿下的行发推送。
  // 即使 cron 重叠触发，同一个提醒也只会通知一次。
  const { data: claimedRows } = await supabase
    .from("price_alerts")
    .update({ triggered_at: new Date().toISOString() })
    .in(
      "id",
      triggered.map((a) => a.id)
    )
    .is("triggered_at", null)
    .select("id");

  const claimed = new Set((claimedRows ?? []).map((r) => (r as { id: string }).id));
  const toNotify = triggered.filter((a) => claimed.has(a.id));

  for (const alert of toNotify) {
    const { data: prefs } = await supabase
      .from("notification_prefs")
      .select("price_alerts")
      .eq("user_id", alert.userId)
      .maybeSingle();
    // 偏好行不存在时按默认（开启）处理
    if (prefs && (prefs as { price_alerts: boolean }).price_alerts === false) continue;

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, locale, failed_count")
      .eq("user_id", alert.userId);

    const rows = (subs ?? []) as SubscriptionRow[];
    if (rows.length === 0) continue;

    // 同一台设备可能存了不同语言，按行各自生成文案
    await Promise.all(
      rows.map((row) => {
        const message = buildAlertMessage(
          row.locale,
          alert.symbol,
          alert.direction,
          alert.targetPrice
        );
        return sendToSubscriptions([row], {
          ...message,
          url: `/${row.locale}/trade?symbol=${encodeURIComponent(alert.symbol)}`,
          tag: `alert-${alert.id}`,
        });
      })
    );
  }

  await beat(supabase, "ok");
  return NextResponse.json({ checked: pending.length, triggered: toNotify.length });
}

async function beat(
  supabase: ReturnType<typeof createServiceRoleClient>,
  status: "ok" | "error"
) {
  // 心跳让「巡检静默停摆」变得可见——Supabase Free 项目 7 天无活动会暂停，
  // 停了之后提醒不会报错，只是永远不触发
  await supabase
    .from("cron_heartbeats")
    .upsert(
      { job_name: JOB_NAME, last_run_at: new Date().toISOString(), last_status: status },
      { onConflict: "job_name" }
    );
}
