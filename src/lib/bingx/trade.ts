import { signedRequest } from "./signed-request";

// ==================== 类型 ====================

export type OrderSide = "BUY" | "SELL";
export type OrderType =
  | "MARKET" | "LIMIT"
  | "TAKE_STOP_LIMIT" | "TAKE_STOP_MARKET"
  | "TRIGGER_LIMIT" | "TRIGGER_MARKET";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "PostOnly";
export type CancelRestrictions = "NEW" | "PENDING" | "PARTIALLY_FILLED";
export type CancelReplaceMode = "STOP_ON_FAILURE" | "ALLOW_FAILURE";

// ==================== 响应类型 ====================

export interface BingXOrderResult {
  symbol: string;
  orderId: string;
  clientOrderID?: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
}

export interface BingXOrder {
  symbol: string;
  orderId: string;
  clientOrderID?: string;
  price: string;
  stopPrice?: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  origQuoteOrderQty?: string;
  status: string;
  type: string;
  side: string;
  time: number;
  updateTime: number;
  fee?: string;
  feeAsset?: string;
}

export interface BingXBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BingXTradeRecord {
  symbol: string;
  id: string;
  orderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

export interface BingXOcoOrderResult {
  orderListId: string;
  contingencyType: string;
  listStatusType: string;
  listOrderStatus: string;
  transactionTime: number;
  symbol: string;
  listClientOrderId?: string;
  orders: Array<{ symbol: string; orderId: string; clientOrderId?: string }>;
  orderReports: Array<BingXOrderResult>;
}

// ==================== 账户 ====================

export async function getBalance(
  apiKey: string, secret: string
): Promise<{ balances: BingXBalance[] }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/account/balance");
}

// ==================== 下单 ====================

export async function placeOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    stopPrice?: string;
    timeInForce?: TimeInForce;
    newClientOrderId?: string;
  }
): Promise<BingXOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
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
  orders: Array<{
    symbol: string; side: OrderSide; type: OrderType;
    quantity?: string; quoteOrderQty?: string; price?: string;
    stopPrice?: string; timeInForce?: TimeInForce; newClientOrderId?: string;
  }>,
  sync = false
): Promise<{ orders: BingXOrderResult[] }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/batchOrders", {
    data: JSON.stringify(orders),
    sync: sync ? "true" : "false",
  });
}

// ==================== OCO 下单 (正确路径 /oco/order) ====================

export async function placeOcoOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    side: OrderSide;
    quantity: string;
    limitPrice: string;
    triggerPrice: string;
    orderPrice: string;
    listClientOrderId?: string;
    aboveClientOrderId?: string;
    belowClientOrderId?: string;
  }
): Promise<BingXOcoOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    quantity: params.quantity,
    limitPrice: params.limitPrice,
    triggerPrice: params.triggerPrice,
    orderPrice: params.orderPrice,
  };
  if (params.listClientOrderId) body.listClientOrderId = params.listClientOrderId;
  if (params.aboveClientOrderId) body.aboveClientOrderId = params.aboveClientOrderId;
  if (params.belowClientOrderId) body.belowClientOrderId = params.belowClientOrderId;

  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/oco/order", body);
}

// ==================== OCO 取消 & 查询 ====================

export async function cancelOcoOrder(
  apiKey: string, secret: string,
  params: { orderId?: string; clientOrderId?: string }
): Promise<BingXOcoOrderResult> {
  const body: Record<string, string> = {};
  if (params.orderId) body.orderId = params.orderId;
  if (params.clientOrderId) body.clientOrderId = params.clientOrderId;
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/oco/cancel", body);
}

export async function queryOcoOrderList(
  apiKey: string, secret: string,
  params: { orderListId?: string; clientOrderId?: string }
): Promise<BingXOcoOrderResult> {
  const p: Record<string, string> = {};
  if (params.orderListId) p.orderListId = params.orderListId;
  if (params.clientOrderId) p.clientOrderId = params.clientOrderId;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/oco/orderList", p);
}

export async function queryOcoOpenOrderList(
  apiKey: string, secret: string
): Promise<{ orders: BingXOcoOrderResult[] }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/oco/openOrderList");
}

export async function queryOcoHistoryOrderList(
  apiKey: string, secret: string,
  params?: { startTime?: number; endTime?: number; limit?: number }
): Promise<{ orders: BingXOcoOrderResult[] }> {
  const p: Record<string, string | number> = {};
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.limit) p.limit = params.limit;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/oco/historyOrderList", p);
}

// ==================== 撤单 ====================

export async function cancelOrder(
  apiKey: string, secret: string,
  symbol: string,
  orderId?: string,
  clientOrderID?: string,
  cancelRestrictions?: CancelRestrictions
): Promise<BingXOrderResult> {
  const body: Record<string, string> = { symbol };
  if (orderId) body.orderId = orderId;
  if (clientOrderID) body.clientOrderID = clientOrderID;
  if (cancelRestrictions) body.cancelRestrictions = cancelRestrictions;
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancel", body);
}

/** 取消指定交易对全部挂单 - 官方路径 /cancelOpenOrders */
export async function cancelAllOrders(
  apiKey: string, secret: string, symbol?: string
): Promise<{ orders: BingXOrderResult[] }> {
  const body: Record<string, string> = {};
  if (symbol) body.symbol = symbol;
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancelOpenOrders", body);
}

export async function cancelMultipleOrders(
  apiKey: string, secret: string,
  symbol: string,
  orderIds?: string[],
  clientOrderIDs?: string[],
  process?: number
): Promise<{ orders: BingXOrderResult[] }> {
  const body: Record<string, string | number> = { symbol };
  if (orderIds?.length) body.orderIds = orderIds.join(",");
  if (clientOrderIDs?.length) body.clientOrderIDs = clientOrderIDs.join(",");
  if (process !== undefined) body.process = process;
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancelOrders", body);
}

/** Kill Switch - 倒计时自动撤单 */
export async function cancelAllAfter(
  apiKey: string, secret: string,
  type: "ACTIVATE" | "CLOSE",
  timeOut?: number
): Promise<{ triggerTime: number; status: string }> {
  const body: Record<string, string | number> = { type };
  if (timeOut !== undefined) body.timeOut = Math.min(120, Math.max(10, timeOut));
  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/cancelAllAfter", body);
}

// ==================== 撤单再下单 ====================

export async function cancelReplace(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    cancelReplaceMode: CancelReplaceMode;
    cancelOrderId?: string;
    cancelClientOrderID?: string;
    cancelRestrictions?: CancelRestrictions;
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    stopPrice?: string;
    newClientOrderId?: string;
  }
): Promise<{
  cancelResult: string;
  newOrderResult: string;
  cancelResponse: BingXOrderResult;
  newOrderResponse: BingXOrderResult;
}> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    cancelReplaceMode: params.cancelReplaceMode,
  };
  if (params.cancelOrderId) body.cancelOrderId = params.cancelOrderId;
  if (params.cancelClientOrderID) body.cancelClientOrderID = params.cancelClientOrderID;
  if (params.cancelRestrictions) body.cancelRestrictions = params.cancelRestrictions;
  if (params.quantity) body.quantity = params.quantity;
  if (params.quoteOrderQty) body.quoteOrderQty = params.quoteOrderQty;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.newClientOrderId) body.newClientOrderId = params.newClientOrderId;

  return signedRequest(apiKey, secret, "POST", "/openApi/spot/v1/trade/order/cancelReplace", body);
}

// ==================== 查询订单 ====================

export async function queryOrder(
  apiKey: string, secret: string,
  symbol: string,
  orderId?: string,
  clientOrderID?: string
): Promise<BingXOrder> {
  const p: Record<string, string> = { symbol };
  if (orderId) p.orderId = orderId;
  if (clientOrderID) p.clientOrderID = clientOrderID;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/query", p);
}

export async function getOpenOrders(
  apiKey: string, secret: string, symbol?: string
): Promise<{ orders: BingXOrder[] }> {
  const p: Record<string, string> = {};
  if (symbol) p.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/openOrders", p);
}

export async function getHistoryOrders(
  apiKey: string, secret: string,
  params?: {
    symbol?: string;
    orderId?: string;
    startTime?: number;
    endTime?: number;
    pageIndex?: number;
    pageSize?: number;
    status?: "FILLED" | "CANCELED" | "FAILED";
    type?: OrderType;
  }
): Promise<{ orders: BingXOrder[]; total: number }> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.orderId) p.orderId = params.orderId;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.pageIndex) p.pageIndex = params.pageIndex;
  if (params?.pageSize) p.pageSize = params.pageSize;
  if (params?.status) p.status = params.status;
  if (params?.type) p.type = params.type;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/historyOrders", p);
}

// ==================== 成交记录 ====================

export async function getMyTrades(
  apiKey: string, secret: string,
  params?: {
    symbol?: string;
    orderId?: string;
    startTime?: number;
    endTime?: number;
    fromId?: string;
    limit?: number;
  }
): Promise<{ fills: BingXTradeRecord[] }> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.orderId) p.orderId = params.orderId;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.fromId) p.fromId = params.fromId;
  p.limit = params?.limit || 500;
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/trade/myTrades", p);
}

// ==================== 手续费 (正确路径 /user/commissionRate) ====================

export async function getCommissionRate(
  apiKey: string, secret: string, symbol: string
): Promise<{
  symbol: string;
  makerCommissionRate: string;
  takerCommissionRate: string;
}> {
  return signedRequest(apiKey, secret, "GET", "/openApi/spot/v1/user/commissionRate", { symbol });
}

// ==================== 验证 ====================

export async function verifyApiKey(apiKey: string, secret: string): Promise<boolean> {
  try {
    await getBalance(apiKey, secret);
    return true;
  } catch {
    return false;
  }
}
