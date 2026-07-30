import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { amendFuturesOrder } from "@/lib/bingx/futures";
import { describeBingXError } from "@/lib/trading/errors";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";

/**
 * 修改一个已挂的合约止盈/止损（或其他条件单）的触发价 —— 由图表上拖动
 * 止盈止损线触发。只改 stopPrice，不改数量/方向，所以不需要走下单预检；
 * BingX 自己的 amend 接口本身就要求该订单必须属于调用方的 API Key。
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }
    const userId = authData.user.id;

    const rl = await checkRateLimit(`futures-amend:${userId}`, RATE_LIMITS.FUTURES_TRADE);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: { message: "Too many requests, slow down", i18nKey: "trading.reject.rate_limited" } },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: { message: "Malformed JSON body" } }, { status: 400 });
    }

    const { symbol, orderId, stopPrice } = body as { symbol?: string; orderId?: string; stopPrice?: number };
    if (!symbol || !orderId) {
      return NextResponse.json({ success: false, error: { message: "Missing fields: symbol, orderId" } }, { status: 400 });
    }
    if (!(Number(stopPrice) > 0)) {
      return NextResponse.json({ success: false, error: { message: "stopPrice must be positive" } }, { status: 400 });
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys")
      .select("api_key_encrypted, secret_encrypted")
      .eq("user_id", userId)
      .eq("is_valid", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const result = await amendFuturesOrder(apiKey, secret, {
      symbol,
      orderId: String(orderId),
      stopPrice: String(stopPrice),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
