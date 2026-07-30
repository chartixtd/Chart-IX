import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { cancelReplace } from "@/lib/bingx/trade";
import { describeBingXError } from "@/lib/trading/errors";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import type { OrderSide, OrderType } from "@/lib/bingx/trade";

/**
 * "修改"一个现货止盈止损/条件单的触发价 —— 由图表上拖动止盈止损线触发。
 * BingX 现货没有单纯改价的 amend 接口，只有撤单重下（cancelReplace），所以
 * 这里必须带上原订单的 side/type/quantity 才能重建一张等价的新单，只有
 * stopPrice（或 price）不同。cancelReplaceMode 用 STOP_ON_FAILURE：重下失败
 * 时不撤原单，避免"改坏了变成裸仓无保护"。
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }
    const userId = authData.user.id;

    const rl = await checkRateLimit(`spot-amend:${userId}`, RATE_LIMITS.SPOT_TRADE);
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

    const { symbol, side, type, quantity, price, stopPrice, cancelOrderId } = body as {
      symbol?: string;
      side?: OrderSide;
      type?: OrderType;
      quantity?: string;
      price?: string;
      stopPrice?: number;
      cancelOrderId?: string;
    };
    if (!symbol || !side || !type || !quantity || !cancelOrderId) {
      return NextResponse.json(
        { success: false, error: { message: "Missing fields: symbol, side, type, quantity, cancelOrderId" } },
        { status: 400 }
      );
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

    const result = await cancelReplace(apiKey, secret, {
      symbol,
      side,
      type,
      cancelReplaceMode: "STOP_ON_FAILURE",
      cancelOrderId,
      quantity,
      price: price || undefined,
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
