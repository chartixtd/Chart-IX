// BingX 行情数据类型 (公开接口)

/** 交易对信息 */
export interface BingXSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  status: string;
}

/** 24小时行情 */
export interface BingXTicker {
  symbol: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  priceChange: string;
  priceChangePercent: string;
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

/** 合约信息 */
export interface BingXContract {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractSize: string;
  pricePrecision: number;
  quantityPrecision: number;
  maxLeverage: number;
  status: string;
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
