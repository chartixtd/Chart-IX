import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getFuturesPositions, closePosition, getFuturesBalance, setLeverage, setMarginType, setPositionTpSl, closeAllPositions, adjustPositionMargin } from "@/lib/bingx/futures";

export async function GET(request: NextRequest) {
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

    const { searchParams } = request.nextUrl;
    const type = searchParams.get("type") || "positions";
    const symbol = searchParams.get("symbol") || undefined;

    if (type === "balance") {
      return NextResponse.json({ success: true, data: await getFuturesBalance(apiKey, secret) });
    }
    return NextResponse.json({ success: true, data: await getFuturesPositions(apiKey, secret, symbol) });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    // Tier check: futures management requires pro
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
    const { action, symbol, positionSide, positionId, leverage, marginType, stopLossPrice, takeProfitPrice, amount, directionType } = body;

    switch (action) {
      case "closePosition":
        return NextResponse.json({ success: true, data: await closePosition(apiKey, secret, symbol, positionSide, positionId) });
      case "closeAllPositions":
        return NextResponse.json({ success: true, data: await closeAllPositions(apiKey, secret, symbol) });
      case "setLeverage":
        await setLeverage(apiKey, secret, symbol, leverage, positionSide);
        return NextResponse.json({ success: true });
      case "setMarginType":
        await setMarginType(apiKey, secret, symbol, marginType);
        return NextResponse.json({ success: true });
      case "setPositionTpSl":
        await setPositionTpSl(apiKey, secret, { symbol, positionSide, stopLossPrice, takeProfitPrice });
        return NextResponse.json({ success: true });
      case "adjustMargin":
        return NextResponse.json({ success: true, data: await adjustPositionMargin(apiKey, secret, symbol, positionId, String(amount), directionType || 1) });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
