import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendToSubscriptions, type SubscriptionRow } from "@/lib/push/send";
import { buildTestMessage } from "@/lib/push/messages";
import { checkRateLimit } from "@/lib/trading/rate-limit";

// web-push 需要 node:crypto，不能跑在 Edge runtime 上
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 给自己发一条测试通知。
 *
 * 存在的理由：推送链路有四段都可能断——浏览器权限、service worker 注册、
 * 服务端的订阅行、VAPID 发送——而四段断在用户那里长得完全一样（「什么都
 * 没收到」）。这个端点走的是**完整的真实链路**，收到了就证明四段全通；
 * 没收到时服务端的具体报错会被原样带回页面上。
 *
 * 没有它，验证要等下一轮扫描真的出新卡：扫描间隔 15 分钟，而且不保证
 * 那一轮有新卡。
 *
 * 服务端限流挡的是**配额**，不是吵人——吵人那一面前端 30 秒冷却已经够了，
 * 但那是纯客户端状态，curl 绕开前端循环 POST 完全不受影响，会烧掉
 * Vercel 函数调用与 CPU 预算（Hobby 每月只有 4 CPU-小时，见
 * src/app/api/cron/price-alerts/route.ts 的注释）。max: 2 / 60s 与前端
 * 冷却对齐，正常使用永远够，循环刷不动。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 放在鉴权之后、查订阅行之前：未登录就不该消耗限流预算
  const limit = await checkRateLimit(`push-test:${user.id}`, { windowMs: 60_000, max: 2 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      { status: 429 }
    );
  }

  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale, failed_count")
    .eq("user_id", user.id);

  const rows = (data ?? []) as SubscriptionRow[];
  // 一行都没有本身就是答案：浏览器那边没订阅成功，或者订阅行已被清掉。
  // 这跟「发了但没收到」是完全不同的处置，不能混成同一个 200。
  if (rows.length === 0) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  try {
    // 逐行发：文案按每台设备订阅时存下的 locale 生成，跟 screener 扇出同一个道理
    const results = await Promise.all(
      rows.map((row) =>
        sendToSubscriptions([row], {
          ...buildTestMessage(row.locale),
          url: `/${row.locale}/settings`,
          tag: "test",
        })
      )
    );
    return NextResponse.json({
      sent: results.reduce((n, r) => n + r.sent, 0),
      removed: results.reduce((n, r) => n + r.removed, 0),
    });
  } catch (error) {
    // send.ts 的 configure() 在 VAPID 变量缺失时抛的是一条明确的中文错误
    // （只有变量名，没有值）。原样带回页面——这个按钮存在的全部意义就是让
    // 「为什么收不到」有个具体答案，在这里吞掉它等于把按钮废了。
    // 截断到 200 字符：web-push 的底层错误可能很长，通知区块放不下。
    console.error("[push/test]", error);
    const message = error instanceof Error ? error.message : "Push failed";
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
