import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { placeFuturesOrder, testFuturesOrder } from "@/lib/bingx/futures";
import { preflightOrder } from "@/lib/trading/preflight";
import { canTradeLive } from "@/lib/access";
import { getUserTier } from "@/lib/supabase/get-user-tier";
import { resolveOrderDirection, getDualSideMode, invalidateDualSideMode } from "@/lib/trading/account-mode";
import { recordOrder } from "@/lib/trading/persist";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import { describeBingXError } from "@/lib/trading/errors";
import { roundPrice } from "@/lib/trading/sizing";
import { RATE_LIMITS } from "@/lib/constants";
import type { FuturesOrderType, FuturesTimeInForce } from "@/lib/bingx/futures";

const VALID_TYPES: FuturesOrderType[] = [
  "MARKET", "LIMIT",
  "STOP_MARKET", "STOP",
  "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
  "TRAILING_STOP_MARKET", "TRAILING_TP_SL",
];
const LIMIT_TYPES = new Set<FuturesOrderType>(["LIMIT", "STOP", "TAKE_PROFIT"]);
const STOP_TYPES = new Set<FuturesOrderType>([
  "STOP_MARKET", "STOP", "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
]);
const TRAILING_TYPES = new Set<FuturesOrderType>(["TRAILING_STOP_MARKET", "TRAILING_TP_SL"]);
/** 只有 MARKET / LIMIT 能挂附带止盈止损对象 */
const ATTACHABLE_TPSL = new Set<FuturesOrderType>(["MARKET", "LIMIT"]);
const VALID_TIF: FuturesTimeInForce[] = ["GTC", "IOC", "FOK", "PostOnly"];

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

  if (!canTradeLive(await getUserTier(userId))) {
    return reject("PRO_REQUIRED", "Live trading requires a Pro subscription", 403);
  }

  const rl = await checkRateLimit(`futures-order:${userId}`, RATE_LIMITS.FUTURES_TRADE);
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

  const {
    test, symbol, direction, type, notionalUsdt, referencePrice, leverage,
    price, stopPrice, priceRatePercent, workingType,
    stopLossPrice, takeProfitPrice, timeInForce, reduceOnly,
  } = body;

  if (!symbol || !direction || !type) {
    return reject("MISSING_FIELDS", "Missing fields: symbol, direction, type", 400);
  }
  if (direction !== "LONG" && direction !== "SHORT") {
    return reject("INVALID_DIRECTION", "direction must be LONG or SHORT", 400);
  }
  if (!VALID_TYPES.includes(type)) return reject("INVALID_TYPE", "Invalid order type", 400);
  if (timeInForce && !VALID_TIF.includes(timeInForce)) {
    return reject("INVALID_TIF", "Invalid timeInForce", 400);
  }
  if (LIMIT_TYPES.has(type) && !(Number(price) > 0)) {
    return reject("MISSING_PRICE", "price is required for limit-type orders", 400);
  }
  if (STOP_TYPES.has(type) && !(Number(stopPrice) > 0)) {
    return reject("MISSING_STOP_PRICE", "stopPrice is required for stop/take-profit orders", 400);
  }

  // UI 收百分比（1 = 1%），BingX 要小数且上限为 1
  let priceRate: number | undefined;
  if (TRAILING_TYPES.has(type)) {
    const pct = Number(priceRatePercent);
    if (!(pct > 0) || pct > 100) {
      return reject("INVALID_CALLBACK_RATE", "priceRatePercent must be within (0, 100]", 400);
    }
    priceRate = pct / 100;
  }

  // 客户端理论上已经在 order-type 切换时清空了 TP/SL 状态（见 OrderForm.tsx 的
  // reset effect），但这里是最后一道防线：如果请求体里真的带了 TP/SL 字段却选了
  // 不支持附带 TP/SL 的订单类型，必须显式拒绝，而不是像 `send()` 里那样静默丢弃——
  // 静默丢弃会让用户以为设置了止盈止损，实际上完全没有。
  if (!ATTACHABLE_TPSL.has(type) && (Number(takeProfitPrice) > 0 || Number(stopLossPrice) > 0)) {
    return reject("TPSL_NOT_SUPPORTED", "Take-profit/stop-loss cannot be attached to this order type", 400);
  }

  const lev = Number(leverage) > 0 ? Math.floor(Number(leverage)) : 1;
  const notional = Number(notionalUsdt);
  const refPrice = LIMIT_TYPES.has(type) ? Number(price) : Number(referencePrice);
  if (!(notional > 0)) return reject("INVALID_AMOUNT", "notionalUsdt must be positive", 400);
  if (!(refPrice > 0)) return reject("INVALID_PRICE", "referencePrice must be positive", 400);

  // preflightOrder can THROW: getSymbolSpec deliberately does not cache failures and
  // rethrows on a BingX network error. Without this wrapper a transient exchange
  // outage surfaces to the user as a bare 500 with no readable message.
  let pre;
  try {
    // 限价类的 refPrice 仍是换算基准；市价类的 refPrice 现在只用于展示，
    // preflightOrder 内部风控估值一律用服务端市价，不再信任这里传的值。
    pre = await preflightOrder({
      market: "futures", symbol, direction,
      notionalUsdt: notional, referencePrice: refPrice, leverage: lev,
      isLimitOrder: LIMIT_TYPES.has(type),
    });
  } catch (error) {
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }

  // 落库用小写：既有 /orders 页面与 dashboard 统计都按 "buy"/"sell" 比较
  // pre.code 也可能是 12b 引入的 NO_MARKET_PRICE（服务端取不到市价，直接拒单）
  const sideForLog = direction === "LONG" ? "buy" : "sell";
  if (!pre.ok) {
    if (!test) {
      await recordOrder(supabase, {
        userId, apiKeyId: null, market: "futures", symbol, side: sideForLog, orderType: type,
        quantity: 0, leverage: lev, status: "rejected", riskRejected: true, riskReason: pre.code,
      });
    }
    return reject(pre.code, `Order rejected: ${pre.code}`, 400, pre.limit);
  }

  // id 单独查——用于下面 recordOrder 的审计字段 apiKeyId；解密后的凭证走缓存
  const { data: apiKeys, error: keyError } = await supabase
    .from("api_keys")
    .select("id")
    .eq("user_id", userId)
    .eq("is_valid", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (keyError || !apiKeys?.length) return reject("NO_API_KEY", "No valid API key found", 400);

  const keys = await getDecryptedApiKeys(userId);
  if (!keys) return reject("NO_API_KEY", "No valid API key found", 400);
  const { apiKey, secret } = keys;

  const send = async () => {
    const dualSide = await getDualSideMode(userId, apiKey, secret);
    const { side, positionSide } = resolveOrderDirection(direction, dualSide);

    const params = {
      symbol, side, positionSide, type,
      quantity: pre.qty,
      price: LIMIT_TYPES.has(type) ? roundPrice(Number(price), pre.spec) : undefined,
      stopPrice: STOP_TYPES.has(type) ? roundPrice(Number(stopPrice), pre.spec) : undefined,
      priceRate,
      timeInForce: LIMIT_TYPES.has(type) ? ((timeInForce as FuturesTimeInForce) || "GTC") : undefined,
      workingType: workingType || undefined,
      reduceOnly: reduceOnly === true ? true : undefined,
      stopLoss:
        ATTACHABLE_TPSL.has(type) && Number(stopLossPrice) > 0
          ? JSON.stringify({
              type: "STOP_MARKET",
              stopPrice: Number(roundPrice(Number(stopLossPrice), pre.spec)),
              workingType: "MARK_PRICE",
            })
          : undefined,
      takeProfit:
        ATTACHABLE_TPSL.has(type) && Number(takeProfitPrice) > 0
          ? JSON.stringify({
              type: "TAKE_PROFIT_MARKET",
              stopPrice: Number(roundPrice(Number(takeProfitPrice), pre.spec)),
              workingType: "MARK_PRICE",
            })
          : undefined,
    };

    const fn = test ? testFuturesOrder : placeFuturesOrder;
    return fn(apiKey, secret, params);
  };

  try {
    let result;
    try {
      result = await send();
    } catch (e) {
      // 109400 常见成因之一是持仓模式不匹配——用户可能刚在 BingX App 里改过。
      // 清掉缓存重探一次，只重试这一次，避免把真正的参数错误反复打到交易所。
      const { code } = describeBingXError(e);
      if (code === 109400) {
        invalidateDualSideMode(userId);
        result = await send();
      } else {
        throw e;
      }
    }

    if (!test) {
      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "futures", symbol, side: sideForLog,
        orderType: type, quantity: pre.sizing.qty,
        price: LIMIT_TYPES.has(type) ? Number(price) : null,
        stopPrice: STOP_TYPES.has(type) ? Number(stopPrice) : null,
        leverage: lev, totalValue: pre.sizing.notional,
        bingxOrderId: result.orderIdStr || null,
        status: "pending",
      });
    }

    return NextResponse.json({
      success: true,
      data: { ...result, estimatedQty: pre.qty, requiredMarginUsdt: pre.requiredMarginUsdt },
    });
  } catch (error) {
    const described = describeBingXError(error);
    if (!test) {
      await recordOrder(supabase, {
        userId, apiKeyId: apiKeys[0].id, market: "futures", symbol, side: sideForLog,
        orderType: type, quantity: pre.sizing.qty, leverage: lev, status: "rejected",
        errorMessage: `${described.code ?? "-"}: ${described.rawMessage}`,
      });
    }
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
