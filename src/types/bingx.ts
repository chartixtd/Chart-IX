// BingX 行情数据类型 (公开接口)

/** 现货交易对规格。来源：GET /openApi/spot/v1/common/symbols（响应嵌套在 data.symbols） */
export interface BingXSymbol {
  symbol: string;
  minQty: number;
  maxQty: number;
  minNotional: number;
  maxNotional: number;
  tickSize: number;
  stepSize: number;
  /** 1 = 可交易，0 = 停用 */
  status: number;
}

/** 现货规格接口的实际响应包装 */
export interface BingXSpotSymbolsResponse {
  symbols: BingXSymbol[];
}

/**
 * 24小时行情。
 *
 * 实测（2026-07-29，直连 live 接口）：
 * - 现货 `GET /openApi/spot/v1/ticker/24hr?symbol=...`：`lastPrice` 是 **number**
 *   （如 `63923.02`），`closeTime` 与当时墙钟时间相差 -0.7s。
 * - 合约 `GET /openApi/swap/v2/quote/ticker?symbol=...`：`lastPrice` 是
 *   **string**（如 `"63899.4"`），`closeTime` 相差 -0.4s。
 * 两边字段名一致但 `lastPrice` 类型不同，故声明为 `string | number`；所有读取
 * 都必须过一次数值解析（`parseFloat`/`Number`），不能当字符串处理。
 * `closeTime` 两边都存在，单位 ms epoch，可用于新鲜度校验。
 */
export interface BingXTicker {
  symbol: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  lastPrice: string | number;
  volume: string;
  quoteVolume: string;
  priceChange: string;
  priceChangePercent: string;
  /** 行情快照时间，ms epoch。现货、合约均返回。用于风控估值的新鲜度校验 */
  closeTime: number;
}

/** K线数据 */
export type BingXKlineRow = [
  number,  // 0: open time (ms)
  string,  // 1: open
  string,  // 2: high
  string,  // 3: low
  string,  // 4: close
  string,  // 5: volume
  number,  // 6: close time (ms)
  string,  // 7: quote volume
  number?, // 8: trade count (v1 kline lacks this)
  string?, // 9: taker buy volume
  string?, // 10: taker buy quote volume
  string?  // 11: ignore
];

export interface BingXKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades?: number;
}

/** 订单簿深度 */
export interface BingXDepth {
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][];
}

/** 最新成交 */
export interface BingXTrade {
  id: string;
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
}

/** 合约规格。来源：GET /openApi/swap/v2/quote/contracts */
export interface BingXContract {
  symbol: string;
  asset: string;
  currency: string;
  size: string;
  pricePrecision: number;
  quantityPrecision: number;
  tradeMinQuantity: number;
  tradeMinUSDT: number;
  /**
   * 最大杠杆。BingX 文档列出这两个字段，但 live 接口实际不返回
   * （2026-07-29 实测：944 个合约中出现 0 次），故声明为可选。
   * 权威来源是需签名的 GET /openApi/swap/v2/trade/leverage（见 futures.ts 的 getLeverage）。
   */
  maxLongLeverage?: number;
  maxShortLeverage?: number;
  makerFeeRate: number;
  takerFeeRate: number;
  /** 1 = 可交易，0 = 停用 */
  status: number;
  apiStateOpen: string;
  apiStateClose: string;
}

/** 合约未平仓量 */
export interface BingXOpenInterest {
  symbol: string;
  openInterest: string;
  timestamp: number;
}

/** 溢价指数（含当前资金费率） */
export interface BingXFundingRate {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}
