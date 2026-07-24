import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeFuturesOrder, testFuturesOrder } from "@/lib/bingx/futures";
import type { FuturesOrderType } from "@/lib/bingx/futures";

const VALID_TYPES: FuturesOrderType[] = [
  "MARKET", "LIMIT",
  "STOP_MARKET", "STOP",
  "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
  "TRAILING_STOP_MARKET", "TRAILING_TP_SL",
];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    // Tier check: futures trading requires pro
    const { data: profile } = await supabase
      .from("users")
      .select("tier")
      .eq("id", authData.user.id)
      .single();

    if (!profile || profile.tier !== "pro") {
      return NextResponse.json({ success: false, error: { message: "Futures trading requires Pro subscription" } }, { status: 403 });
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true).limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const body = await request.json();
    const {
      test, symbol, side, positionSide, type, quantity, quoteOrderQty, price,
      stopPrice, activationPrice, callbackRate, timeInForce, workingType,
      clientOrderId, closePosition, reduceOnly, stopGuaranteed,
      stopLoss, takeProfit,
    } = body;

    if (!symbol || !side || !type) {
      return NextResponse.json({ success: false, error: { message: "Missing fields: symbol, side, type" } }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ success: false, error: { message: "Invalid order type" } }, { status: 400 });
    }

    const orderParams = {
      symbol, side, positionSide, type,
      quantity: quantity || undefined,
      quoteOrderQty: quoteOrderQty || undefined,
      price: price || undefined,
      stopPrice: stopPrice || undefined,
      activationPrice: activationPrice || undefined,
      callbackRate: callbackRate ? parseFloat(callbackRate) : undefined,
      timeInForce: timeInForce || undefined,
      workingType: workingType || undefined,
      clientOrderId: clientOrderId || undefined,
      closePosition: closePosition || undefined,
      reduceOnly: reduceOnly || undefined,
      stopGuaranteed: stopGuaranteed || undefined,
      stopLoss: stopLoss || undefined,
      takeProfit: takeProfit || undefined,
    };

    const fn = test ? testFuturesOrder : placeFuturesOrder;
    const result = await fn(apiKey, secret, orderParams);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
