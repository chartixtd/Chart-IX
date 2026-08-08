import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiUserId } from "@/lib/supabase/api-auth";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { getFuturesOpenOrders, cancelFuturesOrder, cancelAllFuturesOrders } from "@/lib/bingx/futures";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET(request: NextRequest) {
  try {
    const userId = await getApiUserId("readonly");
    if (!userId) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const keys = await getDecryptedApiKeys(userId);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol") || undefined;

    const data = await getFuturesOpenOrders(apiKey, secret, symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[bingx/futures/open-orders]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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

    const keys = await getDecryptedApiKeys(authData.user.id);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    const body = await request.json();
    const { action, symbol, orderId } = body;

    if (action === "cancel" && symbol && orderId) {
      return NextResponse.json({ success: true, data: await cancelFuturesOrder(apiKey, secret, symbol, orderId) });
    }
    if (action === "cancelAll") {
      return NextResponse.json({ success: true, data: await cancelAllFuturesOrders(apiKey, secret, symbol) });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    console.error("[bingx/futures/open-orders]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
