import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/supabase/api-auth";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { getFuturesAllOrders } from "@/lib/bingx/futures";
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
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam) : undefined;

    const data = await getFuturesAllOrders(apiKey, secret, { symbol, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
