import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PaperAccount } from "@/types";

export interface PaperLimitOrder {
  id: string;
  account_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  status: "pending" | "filled" | "canceled";
  created_at: string;
  filled_at: string | null;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { data: account } = await supabase
      .rpc("get_or_create_paper_account")
      .single<PaperAccount>();

    if (!account) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { data: orders, error } = await supabase
      .from("paper_limit_orders")
      .select("*")
      .eq("account_id", account.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: (orders as PaperLimitOrder[]) ?? [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { action, orderId } = body as { action?: string; orderId?: string };

    if (action !== "cancel" || !orderId) {
      return NextResponse.json({ success: false, error: { message: "Invalid action or missing orderId" } }, { status: 400 });
    }

    const { data: order, error } = await supabase
      .rpc("cancel_paper_limit_order", { p_order_id: orderId })
      .single<PaperLimitOrder>();

    if (error) {
      const message =
        error.message.includes("order_not_found") ? "订单不存在 / Order not found"
        : error.message.includes("not pending") ? "订单已成交或已取消 / Order already filled or canceled"
        : error.message;
      return NextResponse.json({ success: false, error: { message } }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}

/** 修改纸盘限价单的挂单价。 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, price } = body as { orderId?: string; price?: number };

    if (!orderId || !(Number(price) > 0)) {
      return NextResponse.json(
        { success: false, error: { message: "orderId and positive price are required" } },
        { status: 400 }
      );
    }

    // 验证订单归属
    const { data: account } = await supabase
      .rpc("get_or_create_paper_account")
      .single<PaperAccount>();

    if (!account) {
      return NextResponse.json({ success: false, error: { message: "Paper account not found" } }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from("paper_limit_orders")
      .select("id, status")
      .eq("id", orderId)
      .eq("account_id", account.id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { message: "Order not found or not yours" } },
        { status: 404 }
      );
    }

    if (existing.status !== "pending") {
      return NextResponse.json(
        { success: false, error: { message: "Only pending orders can be amended" } },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("paper_limit_orders")
      .update({ price: Number(price), updated_at: new Date().toISOString() })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ success: false, error: { message: updateError.message } }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}
