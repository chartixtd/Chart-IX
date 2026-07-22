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
  if (json.code !== 0) throw new Error(json.msg || `BingX Futures error ${json.code}`);
  return json.data;
}

// ==================== 类型 ====================

export type FuturesOrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT" | "TAKE_PROFIT_MARKET" | "TAKE_PROFIT_LIMIT" | "TRAILING_STOP_MARKET";

// ==================== 账户 ====================

export interface FuturesBalance {
  asset: string; balance: string;
  crossWalletBalance: string; crossUnPnl: string;
  availableBalance: string; maxWithdrawAmount: string;
}

export async function getFuturesBalance(apiKey: string, secret: string): Promise<FuturesBalance> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/user/balance");
}

// ==================== 仓位 ====================

export interface FuturesPosition {
  symbol: string; positionId: string;
  positionSide: "LONG" | "SHORT";
  positionAmt: string; availableAmt: string;
  unrealizedProfit: string; realisedProfit: string;
  initialMargin: string; margin: string;
  leverage: number; entryPrice: string;
  markPrice: string; liquidationPrice: string;
  marginType: "isolated" | "cross"; notional: string;
}

export async function getFuturesPositions(apiKey: string, secret: string, symbol?: string): Promise<FuturesPosition[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  const res = await signedRequest<{ positions: FuturesPosition[] }>(apiKey, secret, "GET", "/openApi/swap/v2/user/positions", params);
  return res.positions || [];
}

// ==================== 仓位止盈止损 ====================

export async function setPositionTpSl(
  apiKey: string, secret: string,
  params: { symbol: string; positionSide: "LONG" | "SHORT"; stopLossPrice?: string; takeProfitPrice?: string; }
): Promise<void> {
  const body: Record<string, string> = { symbol: params.symbol, positionSide: params.positionSide };
  if (params.stopLossPrice) body.stopLossPrice = params.stopLossPrice;
  if (params.takeProfitPrice) body.takeProfitPrice = params.takeProfitPrice;
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/positionTpSl", body);
}

// ==================== 杠杆 & 保证金模式 ====================

export async function setLeverage(apiKey: string, secret: string, symbol: string, leverage: number, side: "LONG" | "SHORT"): Promise<void> {
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/leverage", { symbol, leverage, side });
}

export async function setMarginType(apiKey: string, secret: string, symbol: string, marginType: "ISOLATED" | "CROSS"): Promise<void> {
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/marginType", { symbol, marginType });
}

// ==================== 下单 ====================

export interface FuturesOrderResult {
  symbol: string; orderId: string;
  side: string; positionSide: string;
  type: string; origQty: string;
  price: string; executedQty: string;
  avgPrice: string; cumQuote: string;
  status: string; leverage: number;
  updateTime: number;
}

export async function placeFuturesOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string; side: "BUY" | "SELL";
    positionSide: "LONG" | "SHORT";
    type: FuturesOrderType;
    quantity?: string; price?: string;
    stopPrice?: string; activationPrice?: string;
    callbackRate?: number;
    workingType?: "MARK_PRICE" | "CONTRACT_PRICE";
  }
): Promise<FuturesOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol, side: params.side,
    positionSide: params.positionSide, type: params.type,
  };

  if (params.quantity) body.quantity = params.quantity;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.activationPrice) body.activationPrice = params.activationPrice;
  if (params.callbackRate) body.callbackRate = params.callbackRate;
  if (params.workingType) body.workingType = params.workingType;

  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/order", body);
}

// ==================== 查询订单 ====================

export interface FuturesOrder {
  symbol: string; orderId: string;
  side: string; positionSide: string;
  type: string; origQty: string;
  price: string; stopPrice?: string;
  executedQty: string; avgPrice: string;
  cumQuote: string; status: string;
  time: number; updateTime: number;
  leverage: number; workingType: string;
}

export async function getFuturesOpenOrders(apiKey: string, secret: string, symbol?: string): Promise<FuturesOrder[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  const res = await signedRequest<{ orders: FuturesOrder[] }>(apiKey, secret, "GET", "/openApi/swap/v2/trade/openOrders", params);
  return res.orders || [];
}

export async function queryFuturesOrder(apiKey: string, secret: string, symbol: string, orderId: string): Promise<FuturesOrder> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/order", { symbol, orderId });
}

// ==================== 撤单 ====================

export async function cancelFuturesOrder(apiKey: string, secret: string, symbol: string, orderId: string): Promise<FuturesOrderResult> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/cancel", { symbol, orderId });
}

export async function cancelAllFuturesOrders(apiKey: string, secret: string, symbol: string): Promise<{ msg: string }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/cancelAll", { symbol });
}

// ==================== 平仓 ====================

export async function closePosition(apiKey: string, secret: string, symbol: string, positionSide: "LONG" | "SHORT"): Promise<FuturesOrderResult> {
  const side = positionSide === "LONG" ? "SELL" : "BUY";
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/closePosition", { symbol, positionSide, side });
}

// ==================== 资金流水 ====================

export interface FuturesIncome {
  symbol: string; incomeType: string;
  income: string; info: string; time: number;
}

export async function getFuturesIncome(apiKey: string, secret: string, symbol?: string, limit = 50): Promise<FuturesIncome[]> {
  const params: Record<string, string | number> = { limit };
  if (symbol) params.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/user/income", params);
}

// ==================== 验证 ====================

export async function verifyFuturesApiKey(apiKey: string, secret: string): Promise<boolean> {
  try { await getFuturesBalance(apiKey, secret); return true; } catch { return false; }
}
