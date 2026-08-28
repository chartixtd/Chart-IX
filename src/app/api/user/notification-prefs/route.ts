import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 三个键全是 optional：PUT 是**部分更新**，不是全量覆盖。
 *
 * 此前三个键都必填，配合客户端「GET 失败就用写死的默认值兜底」，构成一次
 * 静默重置：GET 抖动一次 → 组件把 prefs 落到默认值 → 用户点一下界面上唯一
 * 的开关（screener）→ PUT 把 price_alerts / new_content 也按默认值写回去。
 * 这两个键在 UI 上没有任何入口，用户既看不见被改了，也没法改回来。
 *
 * 至少得传一个键，否则这次请求什么都没说。
 */
const schema = z
  .object({
    price_alerts: z.boolean().optional(),
    screener: z.boolean().optional(),
    new_content: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "至少要传一个偏好键",
  });

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: prefs }, { data: heartbeat }] = await Promise.all([
    supabase
      .from("notification_prefs")
      .select("price_alerts, screener, new_content")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("cron_heartbeats")
      .select("last_run_at, last_status")
      .eq("job_name", "price-alerts")
      .maybeSingle(),
  ]);

  return NextResponse.json({
    // 偏好行不存在时返回默认值：选币默认关闭，其余默认开启
    prefs: prefs ?? { price_alerts: true, screener: false, new_content: true },
    heartbeat: heartbeat ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 裸 await request.json() 在空 body / 畸形 JSON 上抛的是 SyntaxError，
  // 会逃逸成一个笼统的 Next.js 500。跟 push/subscribe 路由同款处理成 400。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid prefs" }, { status: 400 });

  // 只把**传来的键**放进这一行。zod 已经把未知键剥掉了，这里再滤一次 undefined：
  // 显式的 `{ screener: undefined }` 传给 supabase-js 会被 JSON 序列化掉，
  // 行为上等价，但滤掉之后 upsert 的 SET 列表是可读的、也不依赖那个巧合。
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );

  // upsert 在这里是 `INSERT ... ON CONFLICT (user_id) DO UPDATE SET <提供的列>`：
  // 冲突时只 SET 我们放进 patch 的列，没传的列**保持原值不动**——这正是部分
  // 更新要的语义。无行时缺的键由 026 迁移的列默认值补上
  // （price_alerts/new_content 默认开、screener 默认关），与 GET 的兜底一致。
  const { error } = await supabase.from("notification_prefs").upsert(
    { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("[user/notification-prefs]", error);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
