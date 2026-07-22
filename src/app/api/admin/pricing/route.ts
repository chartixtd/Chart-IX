import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

// PATCH - Update a pricing config by id
export async function PATCH(request: NextRequest) {
  try {
    const { id, price, original_price, currency_symbol, is_active } = await request.json();

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const updates: Record<string, unknown> = {};

    if (typeof price === "number") updates.price = price;
    if (original_price !== undefined) updates.original_price = original_price;
    if (typeof currency_symbol === "string") updates.currency_symbol = currency_symbol;
    if (typeof is_active === "boolean") updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const client = createServiceRoleClient();
    const { error } = await client
      .from("pricing_config")
      .update(updates)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
