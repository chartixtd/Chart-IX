import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PaperAccount, PaperOrder } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10) || 20, 100);

    const { data: account } = await supabase
      .rpc("get_or_create_paper_account")
      .single<PaperAccount>();

    if (!account) {
      return NextResponse.json({ success: true, data: [] });
    }

    let query = supabase
      .from("paper_orders")
      .select("*")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (symbol) query = query.eq("symbol", symbol);

    const { data: orders, error } = await query;
    if (error) {
      console.error("[paper/orders]", error);
      return NextResponse.json({ success: false, error: { message: "Failed to load orders" } }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: (orders as PaperOrder[]) ?? [] });
  } catch (error) {
    console.error("[paper/orders]", error);
    return NextResponse.json({ success: false, error: { message: "Unexpected error" } }, { status: 500 });
  }
}
