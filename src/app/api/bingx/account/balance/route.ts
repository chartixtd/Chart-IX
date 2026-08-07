import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiUserId } from "@/lib/supabase/api-auth";
import { decrypt } from "@/lib/crypto";
import { getBalance } from "@/lib/bingx/trade";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET() {
  try {
    const userId = await getApiUserId("readonly");
    if (!userId) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const supabase = await createClient();
    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", userId).eq("is_valid", true).limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json(
        { success: false, error: { message: "No valid API key found" } },
        { status: 400 }
      );
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

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
