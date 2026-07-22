import { createHmac } from "crypto";

const BINGX_BASE = process.env.BINGX_API_BASE_URL || "https://open-api.bingx.com";

/** Generate HMAC-SHA256 signature for BingX private API */
function sign(secret: string, method: string, path: string, params: Record<string, string | number>): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const prehash = `${method.toUpperCase()}${path}${sorted}`;
  return createHmac("sha256", secret).update(prehash).digest("hex");
}

/** Make a signed request to BingX private API */
async function signedRequest<T>(
  apiKey: string,
  secret: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
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
    headers: {
      "X-BX-APIKEY": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? new URLSearchParams(body as Record<string, string>).toString() : undefined,
  });

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.msg || `BingX error ${json.code}`);
  }
  return json.data;
}

// ==================== 账户 ====================

export interface BingXBalance {
  asset: string;
  free: string;
  locked: string;
}

/** 查询现货账户余额 */
export async function getBalance(apiKey: string, secret: string): Promise<{ balances: BingXBalance[] }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/account/balance");
}

// ==================== 下单 ====================

export interface BingXOrderResult {
  symbol: string;
  orderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
}

/** 现货下单 */
export async function placeOrder(
  apiKey: string,
  secret: string,
  params: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT";
    quantity: string;
    price?: string;
  }
): Promise<BingXOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };

  if (params.type === "MARKET") {
    // MARKET order: use quoteOrderQty for USDT pairs
    body.quoteOrderQty = params.quantity;
  } else {
    body.quantity = params.quantity;
    if (params.price) body.price = params.price;
  }

  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/order", body);
}

// ==================== 查询订单 ====================

export interface BingXOrder {
  symbol: string;
  orderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
  time: number;
  updateTime: number;
}

/** 查询单个订单 */
export async function queryOrder(
  apiKey: string,
  secret: string,
  symbol: string,
  orderId: string
): Promise<BingXOrder> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/query", { symbol, orderId });
}

/** 查询当前挂单 */
export async function getOpenOrders(
  apiKey: string,
  secret: string,
  symbol?: string
): Promise<{ orders: BingXOrder[] }> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/openOrders", params);
}

/** 查询历史订单 */
export async function getHistoryOrders(
  apiKey: string,
  secret: string,
  symbol?: string
): Promise<{ orders: BingXOrder[] }> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/historyOrders", params);
}

// ==================== 撤单 ====================

/** 撤销订单 */
export async function cancelOrder(
  apiKey: string,
  secret: string,
  symbol: string,
  orderId: string
): Promise<BingXOrderResult> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancel", { symbol, orderId });
}

// ==================== 验证 API Key ====================

/** 验证 API Key 是否有效（通过查询余额来测试） */
export async function verifyApiKey(apiKey: string, secret: string): Promise<boolean> {
  try {
    await getBalance(apiKey, secret);
    return true;
  } catch {
    return false;
  }
}
