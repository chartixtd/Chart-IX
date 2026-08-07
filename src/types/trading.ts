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
  /**
   * 最大杠杆。**实践中对合约恒为 undefined**——BingX 公开合约接口不返回杠杆上限
   * （2026-07-29 实测 0/944）。权威来源是需签名的 GET /openApi/swap/v2/trade/leverage，
   * 前端通过 useFuturesAccount 取得，服务端 preflight 不据此校验。
   * 保留该字段是为了 BingX 若恢复公开返回时能自动生效。
   */
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

export interface PreflightInput {
  market: TradingMarket;
  symbol: string;
  /** 用户选的方向；现货 BUY/SELL 直接映射，合约 LONG/SHORT 在路由层转换 */
  direction: "LONG" | "SHORT";
  /** 用户输入的仓位名义额（USDT） */
  notionalUsdt: number;
  /** 换算参考价：限价单用限价，市价单用最新价 */
  referencePrice: number;
  leverage: number;
  /** 该订单类型是否以限价成交（LIMIT / STOP / TAKE_PROFIT 等）。决定换算基准 */
  isLimitOrder: boolean;
}

export type PreflightRejectCode =
  | "UNKNOWN_SYMBOL"
  | "NO_MARKET_PRICE"
  | SizeValidationReason;

export type PreflightResult =
  | {
      ok: true;
      spec: SymbolSpec;
      /** 已对齐精度、可直接发给 BingX 的数量字符串 */
      qty: string;
      sizing: OrderSizing;
      requiredMarginUsdt: number;
      /** 服务端自行获取的市价；绝不来自客户端 */
      marketPrice: number;
      /** 按服务端市价计算的真实敞口（USDT），与客户端报价无关 */
      riskNotionalUsdt: number;
    }
  | { ok: false; code: PreflightRejectCode; limit?: number | string };
