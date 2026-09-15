import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/supabase/api-auth";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { reconcileOrders } from "@/lib/trading/reconcile";
import { RATE_LIMITS } from "@/lib/constants";

/**
 * 把本地 orders 表里尚未终结的实盘单与 BingX 对一遍账。
 *
 * /orders 页面和 dashboard 挂载时各调一次。真正决定往返次数的是
 * reconcile.ts 里的冷却窗口，不是调用方的频率。
 */
export async function POST() {
  // 有写语义（会改 orders 行），按 api-auth 的约定必须走 verified。
  const userId = await getApiUserId("verified");
  if (!userId) {
    return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
  }

  const rl = await checkRateLimit(`orders-sync:${userId}`, RATE_LIMITS.ORDER_SYNC);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { message: "Too many requests, slow down" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // reconcileOrders 内部已经吞掉了单笔订单的失败，这里再兜一层，
  // 是因为对账挂在页面加载路径上——它失败时页面应该照常显示已有历史。
  try {
    const result = await reconcileOrders(userId);
    return NextResponse.json({ success: true, data: result });
  } catch {
    return NextResponse.json({ success: true, data: { checked: 0, updated: 0, failed: 0 } });
  }
}
