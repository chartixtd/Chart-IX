import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PaperAccount, PaperHolding } from "@/types";

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
      return NextResponse.json({ success: false, error: { message: accError?.message || "Failed to load paper account" } }, { status: 500 });
    }

    const { data: holdings } = await supabase
      .from("paper_holdings")
      .select("*")
      .eq("account_id", account.id)
      .order("symbol", { ascending: true });

    return NextResponse.json({
      success: true,
      data: { account, holdings: (holdings as PaperHolding[]) ?? [] },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}
