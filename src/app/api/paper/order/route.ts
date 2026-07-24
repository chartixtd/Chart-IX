import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSpotTicker } from "@/lib/bingx/market";
import type { PaperOrder } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, side, quoteAmount } = body as { symbol?: string; side?: string; quoteAmount?: string | number };

    if (!symbol || !side || !quoteAmount) {
      return NextResponse.json({ success: false, error: { message: "Missing fields: symbol, side, quoteAmount" } }, { status: 400 });
    }
    if (side !== "buy" && side !== "sell") {
      return NextResponse.json({ success: false, error: { message: "side must be buy or sell" } }, { status: 400 });
    }

    const amount = typeof quoteAmount === "string" ? parseFloat(quoteAmount) : quoteAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: { message: "quoteAmount must be a positive number" } }, { status: 400 });
    }

    // 用交易所的最新真实价格执行，不信任客户端传的价格
    const ticker = await getSpotTicker(symbol);
    const price = parseFloat(ticker.lastPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ success: false, error: { message: "Failed to fetch current price" } }, { status: 502 });
    }

    const quantity = amount / price;

    const { data: order, error } = await supabase
      .rpc("place_paper_order", {
        p_symbol: symbol,
        p_side: side,
        p_quantity: quantity,
        p_price: price,
      })
      .single<PaperOrder>();

    if (error) {
      const message =
        error.message.includes("insufficient_balance") ? "余额不足 / Insufficient balance"
        : error.message.includes("insufficient_holding") ? "持仓不足 / Insufficient holding"
        : error.message;
      return NextResponse.json({ success: false, error: { message } }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}
