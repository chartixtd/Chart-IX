import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PaperAccount, PaperPosition } from "@/types";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { data: account, error: accError } = await supabase
      .rpc("get_or_create_paper_account")
      .single<PaperAccount>();

    if (accError || !account) {
      if (accError) console.error("[paper/account]", accError);
      return NextResponse.json({ success: false, error: { message: "Failed to load paper account" } }, { status: 500 });
    }

    const { data: positions } = await supabase
      .from("paper_positions")
      .select("*")
      .eq("account_id", account.id)
      .order("symbol", { ascending: true });

    return NextResponse.json({
      success: true,
      data: { account, positions: (positions as PaperPosition[]) ?? [] },
    });
  } catch (error) {
    console.error("[paper/account]", error);
    return NextResponse.json({ success: false, error: { message: "Unexpected error" } }, { status: 500 });
  }
}
