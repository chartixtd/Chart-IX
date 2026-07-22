import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeOrder } from "@/lib/bingx/trade";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, side, type, quantity, price } = body;

    if (!symbol || !side || !type || !quantity) {
      return NextResponse.json(
        { success: false, error: { message: "Missing required fields: symbol, side, type, quantity" } },
        { status: 400 }
      );
    }

    if (!["BUY", "SELL"].includes(side)) {
      return NextResponse.json({ success: false, error: { message: "side must be BUY or SELL" } }, { status: 400 });
    }
    if (!["MARKET", "LIMIT"].includes(type)) {
      return NextResponse.json({ success: false, error: { message: "type must be MARKET or LIMIT" } }, { status: 400 });
    }
    if (type === "LIMIT" && !price) {
      return NextResponse.json(
        { success: false, error: { message: "price is required for LIMIT orders" } },
        { status: 400 }
      );
    }

    // Fetch user's API keys
    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys")
      .select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id)
      .eq("is_valid", true)
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json(
        { success: false, error: { message: "No valid API key found. Please add your BingX API key in Settings." } },
        { status: 400 }
      );
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const result = await placeOrder(apiKey, secret, { symbol, side, type, quantity, price });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}
