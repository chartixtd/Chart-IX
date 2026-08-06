import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  symbol: z.string().min(1).max(30),
  targetPrice: z.number().positive().finite(),
  direction: z.enum(["above", "below"]),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("price_alerts")
    .select("id, symbol, target_price, direction, triggered_at, created_at")
    .order("created_at", { ascending: false });

  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  // 迁移路径：客户端把 localStorage 里的存量提醒一次性推上来
  if (Array.isArray(body?.migrate)) {
    const parsed = z.array(createSchema).safeParse(body.migrate);
    if (!parsed.success) return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
    if (parsed.data.length === 0) return NextResponse.json({ migrated: 0 });

    const { error } = await supabase.from("price_alerts").insert(
      parsed.data.map((a) => ({
        user_id: user.id,
        symbol: a.symbol,
        target_price: a.targetPrice,
        direction: a.direction,
      }))
    );
    if (error) {
      console.error("[user/alerts] migrate", error);
      return NextResponse.json({ error: "Failed to migrate alerts" }, { status: 500 });
    }
    return NextResponse.json({ migrated: parsed.data.length });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid alert" }, { status: 400 });

  const { data, error } = await supabase
    .from("price_alerts")
    .insert({
      user_id: user.id,
      symbol: parsed.data.symbol,
      target_price: parsed.data.targetPrice,
      direction: parsed.data.direction,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[user/alerts] create", error);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
  return NextResponse.json({ id: (data as { id: string }).id });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await supabase.from("price_alerts").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
