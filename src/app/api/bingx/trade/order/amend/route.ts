import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { cancelReplace } from "@/lib/bingx/trade";
import { describeBingXError } from "@/lib/trading/errors";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import type { OrderSide, OrderType } from "@/lib/bingx/trade";

/**
 * 修改现货挂单。
 *
 * - 止盈止损 / 条件单 → 改 stopPrice（拖动图表线或手动编辑）
 * - 限价单 → 改 price（手动编辑）
 *
 * BingX 现货没有单纯改价的 amend 接口，只有撤单重下（cancelReplace），所以
 * 必须带上原订单的 side/type/quantity 才能重建一张等价的新单，只有
 * stopPrice 或 price 不同。cancelReplaceMode 用 STOP_ON_FAILURE：重下失败
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
      price?: number;
      stopPrice?: number;
      cancelOrderId?: string;
    };

    if (!symbol || !side || !type || !quantity || !cancelOrderId) {
      return NextResponse.json(
        { success: false, error: { message: "Missing fields: symbol, side, type, quantity, cancelOrderId" } },
        { status: 400 }
      );
    }

    // 至少要改了价格或触发价之一，否则没有修改意义
    const hasPrice = Number(price) > 0;
    const hasStop = Number(stopPrice) > 0;
    if (!hasPrice && !hasStop) {
      return NextResponse.json(
        { success: false, error: { message: "price or stopPrice must be positive" } },
        { status: 400 }
      );
    }

    const keys = await getDecryptedApiKeys(userId);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    const result = await cancelReplace(apiKey, secret, {
      symbol,
      side,
      type,
      cancelReplaceMode: "STOP_ON_FAILURE",
      cancelOrderId,
      quantity,
      price: hasPrice ? String(price) : undefined,
      stopPrice: hasStop ? String(stopPrice) : undefined,
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
