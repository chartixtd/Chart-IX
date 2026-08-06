import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  price_alerts: z.boolean(),
  screener: z.boolean(),
  new_content: z.boolean(),
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

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid prefs" }, { status: 400 });

  const { error } = await supabase.from("notification_prefs").upsert(
    { user_id: user.id, ...parsed.data, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  if (error) {
    console.error("[user/notification-prefs]", error);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
