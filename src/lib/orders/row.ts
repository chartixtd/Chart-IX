import type { Order, OrderStatus, PaperOrder } from "@/types";

/**
 * /orders 页面的统一行模型。
 *
 * 页面要同时呈现三个来源的单：实盘（orders 表）、模拟盘成交流水
 * （paper_orders）、模拟盘挂单（paper_limit_orders）。三张表列名和口径都不同，
 * 与其在组件里到处 if，不如先归一到这一个形状。
 */

export type OrderSource = "live" | "paper";

export interface OrderRow {
  id: string;
  source: OrderSource;
  market: "spot" | "futures";
  symbol: string;
  side: "buy" | "sell";
  /** BingX 原始类型名，大写。模拟盘用 MARKET / LIMIT 表示。 */
  orderType: string;
  status: OrderStatus;
  quantity: number;
  /** 委托价。市价单为 null。 */
  price: number | null;
  /** 触发价，止损/止盈类才有。 */
  stopPrice: number | null;
  executedQty: number | null;
  executedPrice: number | null;
  totalValue: number | null;
  fee: number | null;
  feeAsset: string | null;
  leverage: number;
  /** 交易所报错或风控拒绝的原因，展示在状态旁边。 */
  reason: string | null;
  riskRejected: boolean;
  exchangeOrderId: string | null;
  /** 模拟盘平仓单的已实现盈亏；实盘为 null。 */
  realizedPnl: number | null;
  createdAt: string;
}

/**
 * 订单类型的展示名。
 *
 * 键是 orders.order_type 实际落库的值——020 迁移把 CHECK 放宽成了
 * 14 种 BingX 原始类型名，全大写（见 supabase/migrations/020_trading_limits.sql）。
 * 页面之前用的是一张小写键的表，所以每一行都匹配不上，显示的是
 * STOP_MARKET 这种原始串。
 */
const ORDER_TYPE_LABELS: Record<string, string> = {
  // 现货
  MARKET: "Market",
  LIMIT: "Limit",
  TAKE_STOP_LIMIT: "Take/Stop Limit",
  TAKE_STOP_MARKET: "Take/Stop Market",
  TRIGGER_LIMIT: "Trigger Limit",
  TRIGGER_MARKET: "Trigger Market",
  // 合约
  STOP: "Stop Limit",
  STOP_MARKET: "Stop Market",
  TAKE_PROFIT: "Take Profit Limit",
  TAKE_PROFIT_MARKET: "Take Profit Market",
  TRAILING_STOP_MARKET: "Trailing Stop",
  TRAILING_TP_SL: "Trailing TP/SL",
  // 组合单与平仓
  OCO: "OCO",
  CLOSE_POSITION: "Close Position",
  // 006 迁移遗留的小写枚举，历史行里还可能有
  STOP_LOSS: "Stop Loss",
};

export function orderTypeLabel(raw: string): string {
  const key = raw.toUpperCase();
  const known = ORDER_TYPE_LABELS[key];
  if (known) return known;
  // 未知类型也别把下划线大写串直接甩给用户
  return key
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/** 触发价才有意义的类型——价格列要拿 stop_price 而不是 price 去显示。 */
const TRIGGER_TYPES = new Set([
  "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET",
  "TRAILING_STOP_MARKET", "TRAILING_TP_SL",
  "TAKE_STOP_LIMIT", "TAKE_STOP_MARKET", "TRIGGER_LIMIT", "TRIGGER_MARKET",
  "STOP_LOSS",
]);

export function isTriggerType(raw: string): boolean {
  return TRIGGER_TYPES.has(raw.toUpperCase());
}

/**
 * 价格列该显示哪个数。
 *
 * 一列里最多只能放一个数，而一张成交记录里其实有三个价：委托价、触发价、
 * 成交均价。优先级按「这一行现在最该被核对的那个价」排：成交了就看成交均价，
 * 没成交的触发单看触发价，其余看委托价，市价单没有价。
 * kind 用来在数字下面标出这是哪一个价，否则两行相邻的数没法比较。
 */
export type PriceKind = "executed" | "trigger" | "limit" | "market" | "none";

/** 本来就没有价的类型：市价单与平仓单，成交前确实没有任何价可报。 */
const PRICELESS_TYPES = new Set(["MARKET", "CLOSE_POSITION"]);

export function displayPrice(row: OrderRow): { value: number | null; kind: PriceKind } {
  if (row.executedPrice !== null && row.executedPrice > 0) {
    return { value: row.executedPrice, kind: "executed" };
  }
  if (isTriggerType(row.orderType) && row.stopPrice !== null) {
    return { value: row.stopPrice, kind: "trigger" };
  }
  if (row.price !== null && row.price > 0) {
    return { value: row.price, kind: "limit" };
  }
  // 一个价都没有有两种原因，必须分开：市价单本来就不带价，而一张
  // 止损单没有价说明它在到达交易所之前就被拒了。后者标成「市价」是错的。
  return {
    value: null,
    kind: PRICELESS_TYPES.has(row.orderType.toUpperCase()) ? "market" : "none",
  };
}

export function fromLiveOrder(o: Order): OrderRow {
  return {
    id: o.id,
    source: "live",
    market: o.market_type === "futures" ? "futures" : "spot",
    symbol: o.symbol,
    side: (String(o.side).toLowerCase() === "sell" ? "sell" : "buy"),
    orderType: String(o.order_type).toUpperCase(),
    status: o.status,
    quantity: Number(o.quantity),
    price: o.price,
    stopPrice: o.stop_price,
    executedQty: o.executed_qty,
    executedPrice: o.executed_price,
    totalValue: o.total_value,
    fee: o.fee,
    feeAsset: o.fee_asset,
    leverage: o.leverage ?? 1,
    // 风控拒绝的单 error_message 是空的，原因在 risk_reason 里；反之亦然。
    reason: o.error_message ?? o.risk_reason ?? null,
    riskRejected: o.risk_rejected ?? false,
    exchangeOrderId: o.bingx_order_id,
    realizedPnl: null,
    createdAt: o.created_at,
  };
}

/**
 * 模拟盘成交流水。这张表里的每一行都是已经成交的市价单——
 * 模拟撮合是即时的，没有中间态。
 */
export function fromPaperOrder(o: PaperOrder): OrderRow {
  const price = Number(o.price);
  const qty = Number(o.quantity);
  return {
    id: `paper:${o.id}`,
    source: "paper",
    // 018 迁移之后模拟盘只做合约（paper_holdings 现货那套已无人使用）
    market: "futures",
    symbol: o.symbol,
    side: o.side,
    orderType: "MARKET",
    status: "filled",
    quantity: qty,
    price: null,
    stopPrice: null,
    executedQty: qty,
    executedPrice: price,
    totalValue: Number(o.total_value),
    fee: null,
    feeAsset: null,
    leverage: o.leverage ?? 1,
    reason: null,
    riskRejected: false,
    exchangeOrderId: null,
    realizedPnl: o.realized_pnl,
    createdAt: o.created_at,
  };
}

export interface PaperLimitOrderLike {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  status: "pending" | "filled" | "canceled";
  created_at: string;
}

/** 模拟盘挂单。成交的那些同时也会落一条 paper_orders 流水，
 *  为避免同一笔在页面上出现两次，调用方只取 pending / canceled。 */
export function fromPaperLimitOrder(o: PaperLimitOrderLike): OrderRow {
  return {
    id: `paperlimit:${o.id}`,
    source: "paper",
    market: "futures",
    symbol: o.symbol,
    side: o.side,
    orderType: "LIMIT",
    status: o.status,
    quantity: Number(o.quantity),
    price: Number(o.price),
    stopPrice: null,
    executedQty: null,
    executedPrice: null,
    totalValue: Number(o.quantity) * Number(o.price),
    fee: null,
    feeAsset: null,
    leverage: 1,
    reason: null,
    riskRejected: false,
    exchangeOrderId: null,
    realizedPnl: null,
    createdAt: o.created_at,
  };
}
