import { signedRequest } from "./signed-request";

// ==================== 类型 ====================

export type FuturesSide = "BUY" | "SELL";
export type FuturesPositionSide = "LONG" | "SHORT" | "BOTH";
export type FuturesOrderType =
  | "MARKET" | "LIMIT"
  | "STOP_MARKET" | "STOP"
  | "TAKE_PROFIT_MARKET" | "TAKE_PROFIT"
  | "TRAILING_STOP_MARKET" | "TRAILING_TP_SL";
export type FuturesTimeInForce = "GTC" | "IOC" | "FOK" | "PostOnly";
export type FuturesWorkingType = "MARK_PRICE" | "CONTRACT_PRICE" | "INDEX_PRICE";
export type FuturesMarginType = "ISOLATED" | "CROSSED";

// ==================== 响应类型 ====================

/** 来源：GET /openApi/swap/v3/user/balance，返回的是数组 */
export interface FuturesBalance {
  userId: string;
  asset: string;
  balance: string;
  equity: string;
  unrealizedProfit: string;
  realisedProfit: string;
  availableMargin: string;
  usedMargin: string;
}

export interface FuturesPosition {
  symbol: string;
  positionId: string;
  positionSide: "LONG" | "SHORT";
  positionAmt: string;
  availableAmt: string;
  unrealizedProfit: string;
  realisedProfit: string;
  initialMargin: string;
  margin: string;
  leverage: number;
  /** BingX's real field name for entry price on GET /openApi/swap/v2/user/positions */
  avgPrice: string;
  markPrice: string;
  liquidationPrice: string;
  isolated: boolean;
  notional: string;
}

export interface FuturesOrderResult {
  symbol: string;
  /** 数值型订单号，大数在 JS 中可能丢精度（signed-request 用 json-bigint 解析为字符串）——优先用 orderIdStr */
  orderId?: number | string;
  /** 字符串订单号。BingX 在不同端点分别用 orderID / orderId，此处统一为字符串 */
  orderIdStr: string;
  clientOrderId?: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  stopPrice?: string;
  executedQty?: string;
  avgPrice?: string;
  status: string;
  workingType?: string;
  updateTime?: number;
}

/** BingX 合约下单的原始响应包装 */
interface FuturesOrderEnvelope {
  order?: Record<string, unknown>;
  [k: string]: unknown;
}

/** 解包 data.order，并把订单号统一成字符串 */
function unwrapOrder(raw: FuturesOrderEnvelope): FuturesOrderResult {
  if (!raw) throw new Error("BingX returned an empty order response");
  const o = (raw?.order ?? raw) as Record<string, unknown>;
  const idStr = o.orderID ?? o.orderId ?? "";
  return { ...(o as unknown as FuturesOrderResult), orderIdStr: String(idStr) };
}

export interface FuturesOrder {
  symbol: string;
  orderId: string;
  clientOrderId?: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  stopPrice?: string;
  executedQty: string;
  avgPrice?: string;
  cumQuote?: string;
  status: string;
  time: number;
  updateTime: number;
  leverage?: number;
  workingType?: string;
}

export interface FuturesIncome {
  symbol: string;
  incomeType: string;
  income: string;
  info: string;
  time: number;
}

export interface FuturesFillRecord {
  symbol: string;
  orderId: string;
  tradeId?: string;
  side: string;
  positionSide: string;
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  role?: string;
}

export interface FuturesForceOrder {
  symbol: string;
  orderId: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  avgPrice: string;
  executedQty: string;
  status: string;
  time: number;
  updateTime: number;
  forceType?: string;
}

export interface FuturesPositionHistory {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  realisedPnl: string;
  marginType: string;
  leverage: number;
  openTime: number;
  closeTime: number;
}

export interface FuturesTwapOrder {
  orderId: string;
  symbol: string;
  side: string;
  positionSide: string;
  origQty: string;
  executedQty: string;
  executedPercent: string;
  avgPrice: string;
  totalCount: number;
  executedCount: number;
  status: string;
  priceLimit: string;
  createTime: number;
  updateTime: number;
}

// ==================== 账户 ====================

/** 取 USDT 结算账户余额。v3 返回数组，可能含多种结算币 */
export async function getFuturesBalance(
  apiKey: string, secret: string, asset = "USDT"
): Promise<FuturesBalance | null> {
  const rows = await signedRequest<FuturesBalance[]>(
    apiKey, secret, "GET", "/openApi/swap/v3/user/balance"
  );
  if (!Array.isArray(rows)) return null;
  // Deliberately no rows[0] fallback: guessing a different settlement asset
  // (e.g. VST) as "USDT" would show the wrong balance as if it were correct.
  // A missing match must surface as null, not a confident wrong number.
  return rows.find((r) => r.asset === asset) ?? null;
}

// ==================== 仓位 ====================

export async function getFuturesPositions(
  apiKey: string, secret: string, symbol?: string
): Promise<FuturesPosition[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  // BingX 文档：GET /openApi/swap/v2/user/positions 的 data 直接是持仓数组，
  // 不是 { positions: [...] } 包装。此前按包装形状解析，导致 res.positions
  // 在真实数组上恒为 undefined，函数无论账户是否有持仓都返回空数组——
  // 2026-07-29 真实下单测试中发现：BingX 上能看到仓位，网站上一直显示空。
  const res = await signedRequest<FuturesPosition[] | { positions: FuturesPosition[] }>(
    apiKey, secret, "GET", "/openApi/swap/v2/user/positions", params
  );
  if (Array.isArray(res)) return res;
  return res?.positions || [];
}

export async function getPositionHistory(
  apiKey: string, secret: string,
  params?: { symbol?: string; startTime?: number; endTime?: number; limit?: number }
): Promise<FuturesPositionHistory[]> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.limit) p.limit = params.limit || 100;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/trade/positionHistory", p);
}

// ==================== 仓位止盈止损 ====================

export async function setPositionTpSl(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    positionSide?: "LONG" | "SHORT";
    stopLossPrice?: string;
    takeProfitPrice?: string;
    workingType?: FuturesWorkingType;
  }
): Promise<void> {
  const body: Record<string, string> = { symbol: params.symbol };
  if (params.positionSide) body.positionSide = params.positionSide;
  if (params.stopLossPrice) body.stopLossPrice = params.stopLossPrice;
  if (params.takeProfitPrice) body.takeProfitPrice = params.takeProfitPrice;
  if (params.workingType) body.workingType = params.workingType;
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/positionTpSl", body);
}

// ==================== 杠杆 & 保证金模式 ====================

/**
 * BingX 的 GET 与 POST /openApi/swap/v2/trade/leverage 返回的字段形状不一样：
 * POST（设置杠杆）返回扁平的 { leverage }；这个 GET（查询杠杆）按多空分开返回
 * { longLeverage, shortLeverage, maxLongLeverage, maxShortLeverage }，没有
 * 统一的 leverage/maxLeverage 字段。此前误按 POST 的形状声明类型，导致
 * lev.leverage 恒为 undefined，一路传导到前端变成 NaN（2026-07-29 真实下单
 * 测试中发现：点击仓位价值百分比按钮显示 NaN）。
 */
export async function getLeverage(
  apiKey: string, secret: string, symbol: string
): Promise<{
  longLeverage: number; shortLeverage: number;
  maxLongLeverage: number; maxShortLeverage: number;
}> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/leverage", { symbol });
}

export async function setLeverage(
  apiKey: string, secret: string,
  symbol: string, leverage: number, side?: "LONG" | "SHORT"
): Promise<void> {
  const body: Record<string, string | number> = { symbol, leverage };
  if (side) body.side = side;
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/leverage", body);
}

export async function getMarginType(
  apiKey: string, secret: string, symbol: string
): Promise<{ marginType: string }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/marginType", { symbol });
}

export async function setMarginType(
  apiKey: string, secret: string, symbol: string, marginType: FuturesMarginType
): Promise<void> {
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/marginType", { symbol, marginType });
}

// ==================== 持仓模式（单向/双向） ====================

export async function getPositionSideDual(
  apiKey: string, secret: string
): Promise<{ dualSidePosition: boolean }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/positionSide/dual");
}

export async function setPositionSideDual(
  apiKey: string, secret: string, dualSidePosition: boolean
): Promise<void> {
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/positionSide/dual", {
    dualSidePosition: dualSidePosition ? "true" : "false",
  });
}

// ==================== 资产模式（单币/多币） ====================

export async function getAssetMode(
  apiKey: string, secret: string
): Promise<{ assetMode: string }> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/trade/assetMode");
}

export async function setAssetMode(
  apiKey: string, secret: string, assetMode: "SINGLE" | "MULTI"
): Promise<void> {
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/assetMode", { assetMode });
}

export async function getMultiAssetsRules(
  apiKey: string, secret: string
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/trade/multiAssetsRules");
}

export async function getMarginAssets(
  apiKey: string, secret: string
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/user/marginAssets");
}

// ==================== 下单 ====================

export interface PlaceFuturesOrderParams {
  symbol: string;
  side: FuturesSide;
  positionSide?: FuturesPositionSide;
  type: FuturesOrderType;
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  stopPrice?: string;
  activationPrice?: string;
  /** 追踪回撤率，小数形式，0 < x ≤ 1（0.05 = 5%）。TRAILING_STOP_MARKET / TRAILING_TP_SL 必填 */
  priceRate?: number;
  timeInForce?: FuturesTimeInForce;
  workingType?: FuturesWorkingType;
  clientOrderId?: string;
  closePosition?: boolean;
  reduceOnly?: boolean;
  stopGuaranteed?: string; // "true" | "false" | "cutfee"
  positionId?: string;
  stopLoss?: string; // JSON string of stopLoss object
  takeProfit?: string; // JSON string of takeProfit object
}

export async function placeFuturesOrder(
  apiKey: string, secret: string, params: PlaceFuturesOrderParams
): Promise<FuturesOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };

  if (params.positionSide) body.positionSide = params.positionSide;
  if (params.quantity) body.quantity = params.quantity;
  if (params.quoteOrderQty) body.quoteOrderQty = params.quoteOrderQty;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.activationPrice) body.activationPrice = params.activationPrice;
  if (params.priceRate !== undefined) body.priceRate = params.priceRate;
  if (params.timeInForce) body.timeInForce = params.timeInForce;
  if (params.workingType) body.workingType = params.workingType;
  if (params.clientOrderId) body.clientOrderId = params.clientOrderId;
  if (params.closePosition) body.closePosition = "true";
  if (params.reduceOnly) body.reduceOnly = "true";
  if (params.stopGuaranteed) body.stopGuaranteed = params.stopGuaranteed;
  if (params.positionId) body.positionId = params.positionId;
  if (params.stopLoss) body.stopLoss = params.stopLoss;
  if (params.takeProfit) body.takeProfit = params.takeProfit;

  const raw = await signedRequest<FuturesOrderEnvelope>(
    apiKey, secret, "POST", "/openApi/swap/v2/trade/order", body
  );
  return unwrapOrder(raw);
}

// ==================== 测试下单（dry-run） ====================

export async function testFuturesOrder(
  apiKey: string, secret: string, params: PlaceFuturesOrderParams
): Promise<FuturesOrderResult> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };

  if (params.positionSide) body.positionSide = params.positionSide;
  if (params.quantity) body.quantity = params.quantity;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.priceRate !== undefined) body.priceRate = params.priceRate;
  if (params.timeInForce) body.timeInForce = params.timeInForce;
  if (params.workingType) body.workingType = params.workingType;
  if (params.clientOrderId) body.clientOrderId = params.clientOrderId;
  if (params.closePosition) body.closePosition = "true";
  if (params.reduceOnly) body.reduceOnly = "true";
  if (params.stopGuaranteed) body.stopGuaranteed = params.stopGuaranteed;
  if (params.stopLoss) body.stopLoss = params.stopLoss;
  if (params.takeProfit) body.takeProfit = params.takeProfit;

  const raw = await signedRequest<FuturesOrderEnvelope>(
    apiKey, secret, "POST", "/openApi/swap/v2/trade/order/test", body
  );
  return unwrapOrder(raw);
}

// ==================== 批量下单 ====================

export async function placeFuturesBatchOrders(
  apiKey: string, secret: string, orders: PlaceFuturesOrderParams[]
): Promise<{ orders: FuturesOrderResult[]; errors: Array<{ code: number; msg: string }> }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/batchOrders", {
    batchOrders: JSON.stringify(orders.slice(0, 5)),
  });
}

// ==================== 查询订单 ====================

export async function getFuturesOpenOrders(
  apiKey: string, secret: string, symbol?: string, type?: string
): Promise<FuturesOrder[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  if (type) params.type = type;
  const res = await signedRequest<{ orders: FuturesOrder[] }>(
    apiKey, secret, "GET", "/openApi/swap/v2/trade/openOrders", params
  );
  return res.orders || [];
}

export async function queryFuturesOpenOrder(
  apiKey: string, secret: string,
  symbol: string, orderId?: string, clientOrderId?: string
): Promise<FuturesOrder> {
  const params: Record<string, string> = { symbol };
  if (orderId) params.orderId = orderId;
  if (clientOrderId) params.clientOrderId = clientOrderId;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/openOrder", params);
}

export async function queryFuturesOrder(
  apiKey: string, secret: string,
  symbol: string, orderId?: string, clientOrderId?: string
): Promise<FuturesOrder> {
  const params: Record<string, string> = { symbol };
  if (orderId) params.orderId = orderId;
  if (clientOrderId) params.clientOrderId = clientOrderId;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/order", params);
}

export async function queryFuturesFullOrder(
  apiKey: string, secret: string,
  symbol: string, orderId?: string, clientOrderId?: string
): Promise<FuturesOrder> {
  const params: Record<string, string> = { symbol };
  if (orderId) params.orderId = orderId;
  if (clientOrderId) params.clientOrderId = clientOrderId;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/trade/fullOrder", params);
}

export async function getFuturesAllOrders(
  apiKey: string, secret: string,
  params?: {
    symbol?: string;
    currency?: string;
    orderId?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }
): Promise<FuturesOrder[]> {
  const p: Record<string, string | number> = { limit: params?.limit || 500 };
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.currency) p.currency = params.currency;
  if (params?.orderId) p.orderId = params.orderId;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/allOrders", p);
}

// ==================== 强平/ADL 订单 ====================

export async function getFuturesForceOrders(
  apiKey: string, secret: string,
  params?: { symbol?: string; forceType?: string; startTime?: number; endTime?: number; limit?: number }
): Promise<FuturesForceOrder[]> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.forceType) p.forceType = params.forceType;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.limit) p.limit = params.limit;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/forceOrders", p);
}

// ==================== 成交历史 ====================

export async function getFuturesAllFillOrders(
  apiKey: string, secret: string,
  params?: { symbol?: string; orderId?: string; startTime?: number; endTime?: number; limit?: number }
): Promise<FuturesFillRecord[]> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.orderId) p.orderId = params.orderId;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.limit) p.limit = params.limit;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/allFillOrders", p);
}

export async function getFuturesFillHistory(
  apiKey: string, secret: string,
  params?: { symbol?: string; startTime?: number; endTime?: number; limit?: number }
): Promise<FuturesFillRecord[]> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.limit) p.limit = params.limit;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/trade/fillHistory", p);
}

// ==================== 撤单 ====================

export async function cancelFuturesOrder(
  apiKey: string, secret: string,
  symbol: string, orderId?: string, clientOrderId?: string
): Promise<FuturesOrderResult> {
  const params: Record<string, string> = { symbol };
  if (orderId) params.orderId = orderId;
  if (clientOrderId) params.clientOrderId = clientOrderId;
  return signedRequest(apiKey, secret, "DELETE", "/openApi/swap/v2/trade/order", params);
}

export async function cancelFuturesBatchOrders(
  apiKey: string, secret: string,
  symbol: string,
  orderIdList?: number[],
  clientOrderIdList?: string[]
): Promise<{ success: FuturesOrderResult[]; failed: Array<{ code: number; msg: string }> }> {
  const params: Record<string, string> = { symbol };
  if (orderIdList?.length) params.orderIdList = JSON.stringify(orderIdList);
  if (clientOrderIdList?.length) params.clientOrderIdList = JSON.stringify(clientOrderIdList);
  return signedRequest(apiKey, secret, "DELETE", "/openApi/swap/v2/trade/batchOrders", params);
}

export async function cancelAllFuturesOrders(
  apiKey: string, secret: string, symbol?: string, type?: string
): Promise<{ success: FuturesOrderResult[]; failed: Array<{ code: number; msg: string }> }> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  if (type) params.type = type;
  return signedRequest(apiKey, secret, "DELETE", "/openApi/swap/v2/trade/allOpenOrders", params);
}

// ==================== Kill Switch - 倒计时自动撤单 ====================

export async function cancelAllAfterFutures(
  apiKey: string, secret: string,
  type: "ACTIVATE" | "CLOSE", timeOut?: number
): Promise<{ triggerTime: number; status: string; note?: string }> {
  const body: Record<string, string | number> = { type };
  if (timeOut !== undefined) body.timeOut = Math.min(120, Math.max(10, timeOut));
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/cancelAllAfter", body);
}

// ==================== 平仓 ====================

/** 按 positionId 市价全平单个仓位。positionId 从 getFuturesPositions() 取得 */
export async function closePosition(
  apiKey: string, secret: string, positionId: string
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/closePosition", {
    positionId,
  });
}

export async function closeAllPositions(
  apiKey: string, secret: string, symbol?: string
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/closeAllPositions", params);
}

// ==================== 调整保证金 ====================

export async function adjustPositionMargin(
  apiKey: string, secret: string,
  symbol: string, positionId: string, amount: string, directionType: 1 | 2
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/positionMargin", {
    symbol, positionId, amount, direction_type: directionType,
  });
}

export async function getPositionMarginHistory(
  apiKey: string, secret: string,
  symbol: string, positionId?: string, limit?: number
): Promise<Record<string, unknown>[]> {
  const params: Record<string, string | number> = { symbol };
  if (positionId) params.positionId = positionId;
  if (limit) params.limit = limit;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/positionMargin/history", params);
}

// ==================== 自动追加保证金 ====================

export async function setAutoAddMargin(
  apiKey: string, secret: string,
  symbol: string, positionSide: "LONG" | "SHORT", autoAddMargin: boolean
): Promise<void> {
  await signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/autoAddMargin", {
    symbol, positionSide, autoAddMargin: autoAddMargin ? "true" : "false",
  });
}

// ==================== 一键反向 ====================

export async function reversePosition(
  apiKey: string, secret: string,
  symbol: string, positionSide: "LONG" | "SHORT", quantity?: string
): Promise<FuturesOrderResult> {
  const body: Record<string, string> = { symbol, positionSide };
  if (quantity) body.quantity = quantity;
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/reverse", body);
}

// ==================== 撤单再下单 ====================

export async function cancelReplaceFutures(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    side: FuturesSide;
    positionSide?: FuturesPositionSide;
    type: FuturesOrderType;
    cancelOrderId?: string;
    cancelClientOrderId?: string;
    quantity?: string;
    price?: string;
    stopPrice?: string;
    timeInForce?: FuturesTimeInForce;
    workingType?: FuturesWorkingType;
    clientOrderId?: string;
  }
): Promise<{ cancelResult: string; newOrderResult: FuturesOrderResult }> {
  const body: Record<string, string> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };
  if (params.positionSide) body.positionSide = params.positionSide;
  if (params.cancelOrderId) body.cancelOrderId = params.cancelOrderId;
  if (params.cancelClientOrderId) body.cancelClientOrderId = params.cancelClientOrderId;
  if (params.quantity) body.quantity = params.quantity;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.timeInForce) body.timeInForce = params.timeInForce;
  if (params.workingType) body.workingType = params.workingType;
  if (params.clientOrderId) body.clientOrderId = params.clientOrderId;
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/cancelReplace", body);
}

export async function batchCancelReplaceFutures(
  apiKey: string, secret: string, orders: Array<{
    symbol: string; side: FuturesSide; type: FuturesOrderType;
    cancelOrderId?: string; positionSide?: FuturesPositionSide;
    quantity?: string; price?: string;
  }>
): Promise<{ success: Array<Record<string, unknown>>; failed: Array<Record<string, unknown>> }> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/batchCancelReplace", {
    orders: JSON.stringify(orders),
  });
}

// ==================== 修改挂单 ====================

export async function amendFuturesOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    orderId?: string;
    clientOrderId?: string;
    quantity?: string;
    price?: string;
    stopPrice?: string;
    activationPrice?: string;
    priceRate?: number;
  }
): Promise<FuturesOrderResult> {
  const body: Record<string, string | number> = { symbol: params.symbol };
  if (params.orderId) body.orderId = params.orderId;
  if (params.clientOrderId) body.clientOrderId = params.clientOrderId;
  if (params.quantity) body.quantity = params.quantity;
  if (params.price) body.price = params.price;
  if (params.stopPrice) body.stopPrice = params.stopPrice;
  if (params.activationPrice) body.activationPrice = params.activationPrice;
  if (params.priceRate !== undefined) body.priceRate = params.priceRate;
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/trade/amend", body);
}

// ==================== TWAP 算法订单 ====================

export async function createTwapOrder(
  apiKey: string, secret: string,
  params: {
    symbol: string;
    side: FuturesSide;
    positionSide: FuturesPositionSide;
    quantity: string;
    priceLimit: string;
    totalCount: number;
    interval: number; // seconds per slice
    reduceOnly?: boolean;
  }
): Promise<FuturesTwapOrder> {
  const body: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    positionSide: params.positionSide,
    quantity: params.quantity,
    priceLimit: params.priceLimit,
    totalCount: params.totalCount,
    interval: params.interval,
  };
  if (params.reduceOnly) body.reduceOnly = "true";
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/twap/order", body);
}

export async function cancelTwapOrder(
  apiKey: string, secret: string, orderId: string
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v1/twap/cancelOrder", { orderId });
}

export async function getTwapOpenOrders(
  apiKey: string, secret: string, symbol?: string
): Promise<FuturesTwapOrder[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/twap/openOrders", params);
}

export async function getTwapHistoryOrders(
  apiKey: string, secret: string,
  params?: { symbol?: string; startTime?: number; endTime?: number; limit?: number }
): Promise<FuturesTwapOrder[]> {
  const p: Record<string, string | number> = {};
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  if (params?.limit) p.limit = params.limit;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/twap/historyOrders", p);
}

export async function getTwapOrderDetail(
  apiKey: string, secret: string, orderId: string
): Promise<FuturesTwapOrder> {
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/twap/orderDetail", { orderId });
}

// ==================== 维持保证金率 ====================

export async function getMaintMarginRatio(
  apiKey: string, secret: string, symbol?: string
): Promise<Record<string, unknown>[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v1/maintMarginRatio", params);
}

// ==================== 资金流水 ====================

export async function getFuturesIncome(
  apiKey: string, secret: string,
  params?: {
    symbol?: string;
    incomeType?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }
): Promise<FuturesIncome[]> {
  const p: Record<string, string | number> = { limit: params?.limit || 50 };
  if (params?.symbol) p.symbol = params.symbol;
  if (params?.incomeType) p.incomeType = params.incomeType;
  if (params?.startTime) p.startTime = params.startTime;
  if (params?.endTime) p.endTime = params.endTime;
  return signedRequest(apiKey, secret, "GET", "/openApi/swap/v2/user/income", p);
}

// ==================== VST 模拟交易 ====================

export async function getFuturesVst(
  apiKey: string, secret: string
): Promise<Record<string, unknown>> {
  return signedRequest(apiKey, secret, "POST", "/openApi/swap/v2/trade/getVst");
}

// ==================== 验证 ====================

export async function verifyFuturesApiKey(apiKey: string, secret: string): Promise<boolean> {
  try {
    return (await getFuturesBalance(apiKey, secret)) !== null;
  } catch {
    return false;
  }
}
