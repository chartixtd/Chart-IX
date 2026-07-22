import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

export async function PATCH(request: NextRequest) {
  try {
    const { tier, max_order_amount, max_daily_orders, allowed_symbols, max_leverage } =
      await request.json();

    if (!tier || !["free", "pro"].includes(tier)) {
      return NextResponse.json({ error: "tier required (free or pro)" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (max_order_amount !== undefined) updates.max_order_amount = max_order_amount;
    if (max_daily_orders !== undefined) updates.max_daily_orders = max_daily_orders;
    if (allowed_symbols !== undefined) updates.allowed_symbols = allowed_symbols;
    if (max_leverage !== undefined) updates.max_leverage = max_leverage;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("risk_config")
      .update(updates)
      .eq("tier", tier)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
