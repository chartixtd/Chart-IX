import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { cancelOcoOrder, queryOcoOrderList, placeOcoOrder } from "@/lib/bingx/trade";
import { preflightOrder } from "@/lib/trading/preflight";
import { canTradeLive } from "@/lib/access";
import { getUserTier } from "@/lib/supabase/get-user-tier";
import { recordOrder } from "@/lib/trading/persist";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { describeBingXError } from "@/lib/trading/errors";
import { roundPrice } from "@/lib/trading/sizing";
import { RATE_LIMITS } from "@/lib/constants";

function reject(code: string, message: string, status: number, limit?: number | string) {
  return NextResponse.json(
    { success: false, error: { message, i18nKey: `trading.reject.${code.toLowerCase()}`, code, limit } },
    { status }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    const userId = authData.user.id;

    // OCO 走的是真实资金，和现货/合约下单同一条线：免费用户只能用模拟账户。
    // 校验放在 action 分支之前——cancel/query 同样是对实盘账户的操作。
    if (!canTradeLive(await getUserTier(userId))) {
      return reject("PRO_REQUIRED", "Live trading requires a Pro subscription", 403);
    }

    const body = await request.json();
    const { action } = body;

    if (action !== "cancel" && action !== "query" && action !== "place") {
      return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
    }

    // id 单独查——用于下面 recordOrder 的审计字段 apiKeyId；解密后的凭证走缓存
    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("id")
      .eq("user_id", userId).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const keys = await getDecryptedApiKeys(userId);
    if (!keys) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }
    const { apiKey, secret } = keys;

    // Cancel OCO order
    if (action === "cancel") {
      const { orderId, clientOrderId } = body;
      const result = await cancelOcoOrder(apiKey, secret, { orderId, clientOrderId });
      return NextResponse.json({ success: true, data: result });
    }

    // Query OCO order
    if (action === "query") {
      const { orderId, clientOrderId } = body;
      const result = await queryOcoOrderList(apiKey, secret, { orderListId: orderId, clientOrderId });
      return NextResponse.json({ success: true, data: result });
    }

    // Place OCO order — 现在接入和普通现货下单同一套服务端风控换算，
    // 不再直接把用户输入的名义额/价格转发给 BingX（此前禁用下单正是因为
    // 缺这一层）
    const { symbol, side, notionalUsdt, limitPrice, triggerPrice, orderPrice } = body;

    if (!symbol || typeof symbol !== "string") {
      return reject("MISSING_SYMBOL", "symbol is required", 400);
    }
    if (side !== "BUY" && side !== "SELL") {
      return reject("INVALID_SIDE", "side must be BUY or SELL", 400);
    }
    if (!(Number(notionalUsdt) > 0)) {
      return reject("INVALID_AMOUNT", "notionalUsdt must be positive", 400);
    }
    if (!(Number(limitPrice) > 0) || !(Number(triggerPrice) > 0) || !(Number(orderPrice) > 0)) {
      return reject("INVALID_PRICE", "limitPrice, triggerPrice and orderPrice must all be positive", 400);
    }

    const rl = await checkRateLimit(`spot-order:${userId}`, RATE_LIMITS.SPOT_TRADE);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: { message: "Too many orders, slow down", i18nKey: "trading.reject.rate_limited" } },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const sideLower = side === "BUY" ? "buy" : "sell";

    let pre;
    try {
      pre = await preflightOrder({
        market: "spot",
        symbol,
        direction: side === "BUY" ? "LONG" : "SHORT",
        notionalUsdt: Number(notionalUsdt),
        referencePrice: Number(limitPrice),
        leverage: 1,
        isLimitOrder: true,
      });
    } catch (error) {
      const described = describeBingXError(error);
      return NextResponse.json(
        { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
        { status: 502 }
      );
    }

    if (!pre.ok) {
      await recordOrder(supabase, {
        userId, apiKeyId: null, market: "spot", symbol, side: sideLower, orderType: "OCO",
        quantity: 0, status: "rejected", riskRejected: true, riskReason: pre.code,
      });
      return NextResponse.json(
        { success: false, error: { message: `Order rejected: ${pre.code}`, i18nKey: `trading.reject.${pre.code.toLowerCase()}`, code: pre.code, limit: pre.limit } },
        { status: 400 }
      );
    }

    try {
      const result = await placeOcoOrder(apiKey, secret, {
        symbol,
        side,
        quantity: String(pre.qty),
        limitPrice: String(roundPrice(Number(limitPrice), pre.spec)),
        triggerPrice: String(roundPrice(Number(triggerPrice), pre.spec)),
        orderPrice: String(roundPrice(Number(orderPrice), pre.spec)),
      });

      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: "OCO",
        quantity: pre.sizing.qty,
        price: Number(limitPrice),
        stopPrice: Number(triggerPrice),
        leverage: 1,
        totalValue: pre.sizing.notional,
        bingxOrderId: result.orderListId ? String(result.orderListId) : null,
        status: "pending",
      });

      return NextResponse.json({ success: true, data: { ...result, estimatedQty: pre.qty } });
    } catch (error) {
      const described = describeBingXError(error);
      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: "OCO",
        quantity: pre.sizing.qty, status: "rejected",
        errorMessage: `${described.code ?? "-"}: ${described.rawMessage}`,
      });
      return NextResponse.json(
        { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("[bingx/trade/oco-order]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
