import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeFuturesOrder } from "@/lib/bingx/futures";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys")
      .select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id)
      .eq("is_valid", true)
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const { symbol, side, positionSide, type, quantity, price, stopLossPrice, takeProfitPrice } = await request.json();

    if (!symbol || !side || !positionSide || !type || !quantity) {
      return NextResponse.json({ success: false, error: { message: "Missing fields" } }, { status: 400 });
    }

    const result = await placeFuturesOrder(apiKey, secret, {
      symbol, side, positionSide, type, quantity, price, stopLossPrice, takeProfitPrice,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
