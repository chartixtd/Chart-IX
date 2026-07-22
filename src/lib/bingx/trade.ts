import { createHmac } from "crypto";

const BINGX_BASE = process.env.BINGX_API_BASE_URL || "https://open-api.bingx.com";

function sign(secret: string, method: string, path: string, params: Record<string, string | number>): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHmac("sha256", secret).update(`${method.toUpperCase()}${path}${sorted}`).digest("hex");
}

async function signedRequest<T>(
  apiKey: string, secret: string,
  method: "GET" | "POST" | "DELETE", path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const timestamp = Date.now();
  const body: Record<string, string | number> = { ...params, timestamp };
  body.signature = sign(secret, method, path, body);

  const url = new URL(path, BINGX_BASE);
  if (method === "GET" || method === "DELETE") {
    Object.entries(body).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }

  const res = await fetch(url.toString(), {
    method,
    headers: { "X-BX-APIKEY": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? new URLSearchParams(body as Record<string, string>).toString() : undefined,
  });

  const json = await res.json();
  if (json.code !== 0) throw new Error(json.msg || `BingX error ${json.code}`);
  return json.data;
}

// ==================== 类型 ====================

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "TAKE_STOP_LIMIT" | "TAKE_STOP_MARKET" | "TRIGGER_LIMIT" | "TRIGGER_MARKET";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "PostOnly";

// ==================== 账户 ====================

export interface BingXBalance {
  asset: string; free: string; locked: string;
}

export async function getBalance(apiKey: string, secret: string): Promise<{ balances: BingXBalance[] }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/account/balance");
}

// ==================== 下单 ====================

export interface BingXOrderResult {
  symbol: string; orderId: string; transactTime: number;
  price: string; origQty: string; executedQty: string;
  cummulativeQuoteQty: string; status: string; type: string; side: string;
}

export async function placeOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string; side: OrderSide; type: OrderType;
    quantity?: string; quoteOrderQty?: string; price?: string;
    stopPrice?: string; timeInForce?: TimeInForce;
    newClientOrderId?: string;
  }
): Promise<BingXOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol, side: params.side, type: params.type,
  };

  if (params.quantity) body.quantity = params.quantity;
  if (params.quoteOrderQty) body.quoteOrderQty = params.quoteOrderQty;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.timeInForce) body.timeInForce = params.timeInForce;
  if (params.newClientOrderId) body.newClientOrderId = params.newClientOrderId;

  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/order", body);
}

// ==================== 批量下单 ====================

export async function placeMultipleOrders(
  apiKey: string, secret: string,
  orders: Array<{ symbol: string; side: OrderSide; type: OrderType; quantity?: string; price?: string; stopPrice?: string }>,
  sync = false
): Promise<{ orders: BingXOrderResult[] }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/batchOrders", {
    data: JSON.stringify(orders), sync: sync ? "true" : "false",
  });
}

// ==================== OCO 下单 ====================

export interface BingXOcoOrderResult {
  symbol: string; orderListId: string; transactTime: number;
  price: string; origQty: string; executedQty: string;
  cummulativeQuoteQty: string; status: string; type: string; side: string;
}

export async function placeOcoOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string; side: OrderSide;
    quantity: string; price: string;
    stopPrice: string; stopLimitPrice?: string;
  }
): Promise<BingXOcoOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol, side: params.side,
    quantity: params.quantity, price: params.price,
    stopPrice: params.stopPrice,
  };
  if (params.stopLimitPrice) body.stopLimitPrice = params.stopLimitPrice;
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/ocoOrder", body);
}

// ==================== 撤单 ====================

export async function cancelOrder(apiKey: string, secret: string, symbol: string, orderId: string): Promise<BingXOrderResult> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancel", { symbol, orderId });
}

export async function cancelAllOrders(apiKey: string, secret: string, symbol: string): Promise<{ msg: string }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancelAll", { symbol });
}

export async function cancelMultipleOrders(
  apiKey: string, secret: string, symbol: string, orderIds: string[]
): Promise<{ orders: BingXOrderResult[] }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancelOrders", {
    symbol, orderIds: JSON.stringify(orderIds),
  });
}

/** 倒计时撤单 - 设置多少秒后自动撤销所有挂单 */
export async function cancelAllAfter(
  apiKey: string, secret: string, timeout: number
): Promise<{ msg: string }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancelAllAfter", {
    type: "ACTIVATE", timeOut: Math.min(120, Math.max(10, timeout)),
  });
}

/** 撤单再下单 (cancel-replace) */
export async function cancelReplace(
  apiKey: string, secret: string,
  params: {
    symbol: string; cancelOrderId: string;
    side: OrderSide; type: OrderType;
    quantity?: string; price?: string;
  }
): Promise<{ cancelResult: string; newOrderResult: BingXOrderResult }> {
  const body: Record<string, string | number> = {
    symbol: params.symbol, cancelOrderId: params.cancelOrderId,
    side: params.side, type: params.type,
  };
  if (params.quantity) body.quantity = params.quantity;
  if (params.price) body.price = params.price;
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/order/cancelReplace", body);
}

// ==================== 查询订单 ====================

export interface BingXOrder {
  symbol: string; orderId: string; price: string; stopPrice?: string;
  origQty: string; executedQty: string; cummulativeQuoteQty: string;
  status: string; type: string; side: string;
  time: number; updateTime: number;
}

export async function queryOrder(apiKey: string, secret: string, symbol: string, orderId: string): Promise<BingXOrder> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/query", { symbol, orderId });
}

export async function getOpenOrders(apiKey: string, secret: string, symbol?: string): Promise<{ orders: BingXOrder[] }> {
  const p: Record<string, string> = {};
  if (symbol) p.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/openOrders", p);
}

export async function getHistoryOrders(apiKey: string, secret: string, symbol?: string): Promise<{ orders: BingXOrder[] }> {
  const p: Record<string, string> = {};
  if (symbol) p.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/historyOrders", p);
}

// ==================== 成交记录 ====================

export interface BingXTradeRecord {
  symbol: string; id: string; orderId: string;
  price: string; qty: string; quoteQty: string;
  commission: string; commissionAsset: string;
  time: number; isBuyer: boolean; isMaker: boolean;
}

export async function getMyTrades(apiKey: string, secret: string, symbol?: string, limit = 50): Promise<{ trades: BingXTradeRecord[] }> {
  const p: Record<string, string | number> = { limit };
  if (symbol) p.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/myTrades", p);
}

// ==================== 手续费 ====================

export async function getCommissionRate(apiKey: string, secret: string, symbol: string): Promise<{
  symbol: string; makerCommissionRate: string; takerCommissionRate: string;
}> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/commissionRate", { symbol });
}

// ==================== 验证 ====================

export async function verifyApiKey(apiKey: string, secret: string): Promise<boolean> {
  try { await getBalance(apiKey, secret); return true; } catch { return false; }
}
