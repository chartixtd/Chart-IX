import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

// web-push 需要 node:crypto，不能跑在 Edge runtime 上
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  locale: z.string().min(2).max(10),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // request.json() throws a raw SyntaxError on a malformed or empty body, which would
  // escape as a generic Next.js 500 instead of a clean 400.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const { endpoint, keys, locale } = parsed.data;

  // 写入改用 service-role client：endpoint 在 web push 生态里不是秘密，
  // 换账号登录同一设备时这里的 upsert 需要能把行的归属从账号 A 改成账号 B，
  // 这种跨账号改写不该再靠 RLS 的 USING (true) 兜底（那等于任何登录用户
  // 拿到别人的 endpoint 字符串就能抢占/破坏那一行），改成在应用层
  // auth.getUser() 鉴权通过之后，用 service-role 权限执行这次写入
  const serviceClient = createServiceRoleClient();

  // endpoint 唯一：同一台设备重新订阅时更新而非插入，
  // 顺带把 failed_count 归零、刷新 locale（用户可能换了语言）
  const { error } = await serviceClient.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      locale,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      failed_count: 0,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 确保每个订阅者从订阅那一刻起就有一行显式的通知偏好，默认值与
  // 026 迁移的列默认值保持一致（price_alerts/new_content 默认开，screener 默认关）。
  // 不这样做的话，GET /api/user/notification-prefs 会在无行时于应用层
  // 返回「看起来全开」的默认值，但 getOptedInSubscriptions() 是直接按
  // notification_prefs 表查询 .eq(pref, true)，无行的用户根本不在结果集里——
  // 用户在 UI 上看到「已开启」，实际永远收不到 new_content/screener 广播。
  // onConflict + ignoreDuplicates：只在缺行时插入，绝不覆盖用户已改过的偏好
  await serviceClient.from("notification_prefs").upsert(
    {
      user_id: user.id,
      price_alerts: true,
      screener: false,
      new_content: true,
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );

  return NextResponse.json({ success: true });
}
