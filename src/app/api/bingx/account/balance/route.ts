import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/supabase/api-auth";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { getBalance } from "@/lib/bingx/trade";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET() {
  try {
    const userId = await getApiUserId("readonly");
    if (!userId) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const keys = await getDecryptedApiKeys(userId);
    if (!keys) {
      return NextResponse.json(
        { success: false, error: { message: "No valid API key found" } },
        { status: 400 }
      );
    }
    const { apiKey, secret } = keys;

    const data = await getBalance(apiKey, secret);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[bingx/account/balance]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
