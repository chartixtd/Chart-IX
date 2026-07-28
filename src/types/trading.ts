export type TradingMarket = "spot" | "futures";

/** 归一化后的交易对规格，现货与合约共用同一形状 */
export interface SymbolSpec {
  symbol: string;
  market: TradingMarket;
  /** 价格小数位 */
  pricePrecision: number;
  /** 数量小数位 */
  quantityPrecision: number;
  /** 最小下单数量（基础币） */
  minQty: number;
  /** 最小下单名义额（USDT） */
  minNotional: number;
  /** 最大杠杆，仅合约有值 */
  maxLeverage?: number;
  /** taker 费率，用于预览估算手续费；无数据时为 undefined */
  takerFeeRate?: number;
  tradable: boolean;
}

/** 一次名义额→数量换算的结果 */
export interface OrderSizing {
  /** 对齐精度后的币数量 */
  qty: number;
  /** 按对齐后数量重算的实际名义额（USDT），可能略低于用户输入 */
  notional: number;
  /** 换算用的参考价 */
  price: number;
}

export type SizeValidationReason =
  | "BELOW_MIN_QTY"
  | "BELOW_MIN_NOTIONAL"
  | "ZERO_AFTER_ROUNDING"
  | "NOT_TRADABLE"
  | "INVALID_INPUT";

export type SizeValidation =
  | { ok: true }
  | { ok: false; reason: SizeValidationReason; limit?: number };

/** 风控限额配置。任一字段为 null 表示该项不限制 */
export interface TradingLimits {
  maxNotionalPerOrder: number | null;
  maxOrdersPerDay: number | null;
  maxLeverage: number | null;
  allowedSymbols: string[] | null;
}

export interface LimitCheckInput {
  symbol: string;
  notional: number;
  leverage: number;
  ordersToday: number;
}

export type LimitRejectReason =
  | "NOTIONAL_TOO_LARGE"
  | "DAILY_LIMIT_REACHED"
  | "LEVERAGE_TOO_HIGH"
  | "SYMBOL_NOT_ALLOWED";

export type LimitCheck =
  | { ok: true }
  | { ok: false; reason: LimitRejectReason; limit: number | string };
