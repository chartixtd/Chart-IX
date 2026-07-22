import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

export async function GET() {
  try {
    const client = createServiceRoleClient();

    const [total, free, pro, today, disabled] = await Promise.all([
      client.from("users").select("id", { count: "exact", head: true }),
      client.from("users").select("id", { count: "exact", head: true }).eq("tier", "free"),
      client.from("users").select("id", { count: "exact", head: true }).eq("tier", "pro"),
      client
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      client
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("is_disabled", true),
    ]);

    return NextResponse.json({
      totalUsers: total.count ?? 0,
      freeUsers: free.count ?? 0,
      proUsers: pro.count ?? 0,
      todayNew: today.count ?? 0,
      disabledUsers: disabled.count ?? 0,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
