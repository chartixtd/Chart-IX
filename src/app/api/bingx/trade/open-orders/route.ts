import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiUserId } from "@/lib/supabase/api-auth";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { getOpenOrders, cancelOrder, cancelAllOrders } from "@/lib/bingx/trade";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET(request: NextRequest) {
  try {
    const userId = await getApiUserId("readonly");
    if (!userId) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const keys = await getDecryptedApiKeys(userId);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol") || undefined;

    const data = await getOpenOrders(apiKey, secret, symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[bingx/trade/open-orders]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const keys = await getDecryptedApiKeys(authData.user.id);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    const { action, symbol, orderId } = await request.json();

    if (action === "cancel" && symbol && orderId) {
      const data = await cancelOrder(apiKey, secret, symbol, orderId);
      return NextResponse.json({ success: true, data });
    }

    if (action === "cancelAll") {
      const data = await cancelAllOrders(apiKey, secret, symbol);
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    console.error("[bingx/trade/open-orders]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
