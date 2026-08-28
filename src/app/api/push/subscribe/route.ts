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
  // 必须是白名单而不是 z.string()：这个值原样落进 push_subscriptions.locale，
  // 之后被 messages.ts 当作 COPY 表的键去查（原型链污染的入口），又被
  // screener-scan 直接拼进通知的 url（`/${row.locale}/screener`）——
  // 一个任意字符串能让点击通知跳到站外。站点只有三种语言，写死这三种。
  locale: z.enum(["zh-CN", "en-US", "ms-MY"]),
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

  // 下面这次 upsert 会无条件把行的 user_id 改成当前登录用户。这是**有意允许**
  // 的「设备转移」：一台手机换个人登录（家人共用、店里的展示机、账号迁移），
  // 浏览器给的还是同一个 endpoint，新用户必须能接管这一行，否则推送会继续
  // 发给前一个账号的偏好设置。
  //
  // 但这条路径同时也是它的滥用面：endpoint 在 web push 生态里不是秘密，任何
  // 拿到别人 endpoint 字符串的登录用户都能把那一行抢过来（受害者从此收不到
  // 自己的提醒）。029 迁移把 RLS 从 USING(true) 收紧时，注释宣称这个洞被堵上了，
  // 实际只是把它从 RLS 挪到了这个路由——service-role 绕过 RLS，判断权全在这里。
  //
  // 结论是**保留**这次转移（合法场景真实存在，且滥用的收益只是让受害者掉线，
  // 攻击者读不到任何东西），但不能让它悄无声息：先查一次现有归属，换人时留一条
  // 含两个 user_id 的日志。这样账号被人抢占时，日志里有据可查而不是凭空消失。
  const { data: existing } = await serviceClient
    .from("push_subscriptions")
    .select("user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  const previousOwner = (existing as { user_id?: string } | null)?.user_id;
  if (previousOwner && previousOwner !== user.id) {
    console.warn(
      `[push/subscribe] endpoint ownership transfer: ${previousOwner} -> ${user.id}`
    );
  }

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

  if (error) {
    console.error("[push/subscribe]", error);
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }

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
