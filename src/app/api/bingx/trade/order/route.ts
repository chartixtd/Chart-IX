import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeOrder } from "@/lib/bingx/trade";
import type { OrderSide, OrderType, TimeInForce } from "@/lib/bingx/trade";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, side, type, quantity, quoteOrderQty, price, stopPrice, timeInForce } = body;

    if (!symbol || !side || !type) {
      return NextResponse.json({ success: false, error: { message: "Missing fields: symbol, side, type" } }, { status: 400 });
    }

    const VALID_SIDES: OrderSide[] = ["BUY", "SELL"];
    const VALID_TYPES: OrderType[] = [
      "MARKET", "LIMIT",
      "TAKE_STOP_LIMIT", "TAKE_STOP_MARKET",
      "TRIGGER_LIMIT", "TRIGGER_MARKET",
    ];
    const VALID_TIF: TimeInForce[] = ["GTC", "IOC", "FOK", "PostOnly"];

    if (!VALID_SIDES.includes(side)) {
      return NextResponse.json({ success: false, error: { message: "side must be BUY or SELL" } }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ success: false, error: { message: "Invalid order type" } }, { status: 400 });
    }
    if (timeInForce && !VALID_TIF.includes(timeInForce)) {
      return NextResponse.json({ success: false, error: { message: "Invalid timeInForce" } }, { status: 400 });
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true).limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const result = await placeOrder(apiKey, secret, {
      symbol, side, type,
      quantity: quantity || undefined,
      quoteOrderQty: quoteOrderQty || undefined,
      price: price || undefined,
      stopPrice: stopPrice || undefined,
      timeInForce: timeInForce || undefined,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
