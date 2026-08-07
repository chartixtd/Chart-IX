import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { amendFuturesOrder } from "@/lib/bingx/futures";
import { describeBingXError } from "@/lib/trading/errors";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";

/**
 * 修改合约挂单。
 *
 * - 止盈止损 / 条件单 → 改 stopPrice（拖动图表线或手动编辑）
 * - 限价单 → 改 price / quantity（手动编辑）
 *
 * BingX 合约有原生 amend 接口（amendFuturesOrder），支持改价、改量、改触发价，
 * 不需要像现货那样撤单重下。
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

    const { symbol, orderId, price, stopPrice, quantity } = body as {
      symbol?: string;
      orderId?: string;
      price?: number;
      stopPrice?: number;
      quantity?: number;
    };

    if (!symbol || !orderId) {
      return NextResponse.json(
        { success: false, error: { message: "Missing fields: symbol, orderId" } },
        { status: 400 }
      );
    }

    const hasPrice = Number(price) > 0;
    const hasStop = Number(stopPrice) > 0;
    const hasQty = Number(quantity) > 0;
    if (!hasPrice && !hasStop && !hasQty) {
      return NextResponse.json(
        { success: false, error: { message: "At least one of price, stopPrice, or quantity must be positive" } },
        { status: 400 }
      );
    }

    const keys = await getDecryptedApiKeys(userId);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    const result = await amendFuturesOrder(apiKey, secret, {
      symbol,
      orderId: String(orderId),
      price: hasPrice ? String(price) : undefined,
      stopPrice: hasStop ? String(stopPrice) : undefined,
      quantity: hasQty ? String(quantity) : undefined,
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
