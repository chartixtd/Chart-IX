import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { placeOrder } from "@/lib/bingx/trade";
import { preflightOrder } from "@/lib/trading/preflight";
import { recordOrder } from "@/lib/trading/persist";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { describeBingXError } from "@/lib/trading/errors";
import { roundPrice } from "@/lib/trading/sizing";
import { RATE_LIMITS } from "@/lib/constants";
import type { OrderSide, OrderType, TimeInForce } from "@/lib/bingx/trade";

const VALID_SIDES: OrderSide[] = ["BUY", "SELL"];
const VALID_TYPES: OrderType[] = [
  "MARKET", "LIMIT",
  "TAKE_STOP_LIMIT", "TAKE_STOP_MARKET",
  "TRIGGER_LIMIT", "TRIGGER_MARKET",
];
const VALID_TIF: TimeInForce[] = ["GTC", "IOC", "FOK", "PostOnly"];
const LIMIT_TYPES = new Set<OrderType>(["LIMIT", "TAKE_STOP_LIMIT", "TRIGGER_LIMIT"]);
const STOP_TYPES = new Set<OrderType>([
  "TAKE_STOP_LIMIT", "TAKE_STOP_MARKET", "TRIGGER_LIMIT", "TRIGGER_MARKET",
]);

function reject(code: string, message: string, status: number, limit?: number | string) {
  return NextResponse.json(
    { success: false, error: { message, i18nKey: `trading.reject.${code.toLowerCase()}`, code, limit } },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
  }
  const userId = authData.user.id;

  const rl = await checkRateLimit(`spot-order:${userId}`, RATE_LIMITS.SPOT_TRADE);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { message: "Too many orders, slow down", i18nKey: "trading.reject.rate_limited" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // request.json() throws a raw SyntaxError on a malformed or empty body, which would
  // escape as a generic Next.js 500 instead of the documented error envelope.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return reject("INVALID_BODY", "Malformed JSON body", 400);
  }
  const { symbol, side, type, notionalUsdt, referencePrice, price, stopPrice, timeInForce } = body;

  if (!symbol || !side || !type) {
    return reject("MISSING_FIELDS", "Missing fields: symbol, side, type", 400);
  }
  if (!VALID_SIDES.includes(side)) return reject("INVALID_SIDE", "side must be BUY or SELL", 400);
  if (!VALID_TYPES.includes(type)) return reject("INVALID_TYPE", "Invalid order type", 400);
  if (timeInForce && !VALID_TIF.includes(timeInForce)) {
    return reject("INVALID_TIF", "Invalid timeInForce", 400);
  }
  if (LIMIT_TYPES.has(type) && !(Number(price) > 0)) {
    return reject("MISSING_PRICE", "price is required for limit-type orders", 400);
  }
  if (STOP_TYPES.has(type) && !(Number(stopPrice) > 0)) {
    return reject("MISSING_STOP_PRICE", "stopPrice is required for stop/trigger orders", 400);
  }

  const notional = Number(notionalUsdt);
  // 限价类用限价换算，市价类用前端传来的最新成交价
  const refPrice = LIMIT_TYPES.has(type) ? Number(price) : Number(referencePrice);
  if (!(notional > 0)) return reject("INVALID_AMOUNT", "notionalUsdt must be positive", 400);
  if (!(refPrice > 0)) return reject("INVALID_PRICE", "referencePrice must be positive", 400);

  // 落库用小写：既有 /orders 页面与 dashboard 统计都按 "buy"/"sell" 比较
  const sideLower = side === "BUY" ? "buy" : "sell";

  // preflightOrder can THROW: getSymbolSpec deliberately does not cache failures and
  // rethrows on a BingX network error. Without this wrapper a transient exchange
  // outage surfaces to the user as a bare 500 with no readable message.
  let pre;
  try {
    // 限价类的 refPrice 仍是换算基准；市价类的 refPrice 现在只用于展示，
    // preflightOrder 内部风控估值一律用服务端市价，不再信任这里传的值。
    pre = await preflightOrder(supabase, {
      userId,
      market: "spot",
      symbol,
      direction: side === "BUY" ? "LONG" : "SHORT",
      notionalUsdt: notional,
      referencePrice: refPrice,
      leverage: 1,
      isLimitOrder: LIMIT_TYPES.has(type),
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
      userId, apiKeyId: null, market: "spot", symbol, side: sideLower, orderType: type,
      quantity: 0, status: "rejected", riskRejected: true, riskReason: pre.code,
    });
    return reject(pre.code, `Order rejected: ${pre.code}`, 400, pre.limit);
  }

  const { data: apiKeys, error: keyError } = await supabase
    .from("api_keys")
    .select("id, api_key_encrypted, secret_encrypted")
    .eq("user_id", userId)
    .eq("is_valid", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (keyError || !apiKeys?.length) {
    return reject("NO_API_KEY", "No valid API key found", 400);
  }

  const apiKey = decrypt(apiKeys[0].api_key_encrypted);
  const secret = decrypt(apiKeys[0].secret_encrypted);

  try {
    const result = await placeOrder(apiKey, secret, {
      symbol, side, type,
      quantity: pre.qty,
      price: LIMIT_TYPES.has(type) ? roundPrice(Number(price), pre.spec) : undefined,
      stopPrice: STOP_TYPES.has(type) ? roundPrice(Number(stopPrice), pre.spec) : undefined,
      timeInForce: LIMIT_TYPES.has(type) ? (timeInForce || "GTC") : undefined,
    });

    await recordOrder(supabase, {
      userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: type,
      quantity: pre.sizing.qty,
      price: LIMIT_TYPES.has(type) ? Number(price) : null,
      stopPrice: STOP_TYPES.has(type) ? Number(stopPrice) : null,
      leverage: 1,
      totalValue: pre.sizing.notional,
      bingxOrderId: result.orderId ? String(result.orderId) : null,
      status: "pending",
    });

    return NextResponse.json({ success: true, data: { ...result, estimatedQty: pre.qty } });
  } catch (error) {
    const described = describeBingXError(error);
    await recordOrder(supabase, {
      userId, apiKeyId: apiKeys[0].id, market: "spot", symbol, side: sideLower, orderType: type,
      quantity: pre.sizing.qty, status: "rejected",
      errorMessage: `${described.code ?? "-"}: ${described.rawMessage}`,
    });
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
