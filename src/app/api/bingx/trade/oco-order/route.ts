import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeOcoOrder, cancelOcoOrder, queryOcoOrderList } from "@/lib/bingx/trade";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true).limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const body = await request.json();
    const { action, symbol, side, quantity, limitPrice, triggerPrice, orderPrice, orderId, clientOrderId } = body;

    // Place OCO order
    if (action !== "cancel" && action !== "query") {
      if (!symbol || !side || !quantity || !limitPrice || !triggerPrice || !orderPrice) {
        return NextResponse.json({ success: false, error: { message: "Missing fields: symbol, side, quantity, limitPrice, triggerPrice, orderPrice" } }, { status: 400 });
      }
      const result = await placeOcoOrder(apiKey, secret, {
        symbol, side, quantity, limitPrice, triggerPrice, orderPrice,
      });
      return NextResponse.json({ success: true, data: result });
    }

    // Cancel OCO order
    if (action === "cancel") {
      const result = await cancelOcoOrder(apiKey, secret, { orderId, clientOrderId });
      return NextResponse.json({ success: true, data: result });
    }

    // Query OCO order
    if (action === "query") {
      const result = await queryOcoOrderList(apiKey, secret, { orderListId: orderId, clientOrderId });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
