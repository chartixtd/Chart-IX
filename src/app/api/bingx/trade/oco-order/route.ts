import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { cancelOcoOrder, queryOcoOrderList } from "@/lib/bingx/trade";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const body = await request.json();
    const { action } = body;

    // OCO order placement is not yet routed through the server-side risk/preflight
    // layer (src/lib/trading/preflight.ts) that every other order-placement path in
    // this app goes through. Placing an order here would bypass every notional/
    // leverage/rate limit the rest of the app enforces. Cancel/query are read/cancel
    // operations against orders BingX already placed and carry no new sizing risk,
    // so they remain enabled; only new-order placement is disabled pending a proper
    // preflight integration for OCO's three-price parameter shape.
    if (action !== "cancel" && action !== "query") {
      return NextResponse.json(
        { success: false, error: { message: "OCO order placement is temporarily disabled pending risk-limit integration" } },
        { status: 501 }
      );
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);
    const { orderId, clientOrderId } = body;

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
