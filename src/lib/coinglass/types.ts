/** CoinGlass v4 的统一信封。code 是字符串 "0" 表示成功，不是数字。 */
export interface CoinGlassEnvelope<T> {
  code: string;
  msg?: string;
  data?: T;
}

/** /api/futures/pairs-markets 的一行（一个交易所的一个合约） */
export interface CoinGlassPairMarket {
  instrument_id: string;
  exchange_name: string;
  symbol: string;
  current_price: number;
  price_change_percent_24h: number;
  volume_usd: number;
  open_interest_usd: number;
  open_interest_change_percent_24h: number;
  funding_rate: number;
  open_interest_volume_radio: number;
}

/**
 * /api/futures/open-interest/aggregated-history 的一根。OHLC 全是字符串，
 * 和 price/history 一样；没有 volume_usd（这个端点不提供成交量）。
 * 已实测：最新一根与 open-interest/exchange-list 里 exchange==="All"
 * 那一行完全一致，是同一份全交易所聚合数据的历史版本。
 */
export interface CoinGlassOiBar {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

/** /api/futures/liquidation/coin-list 的一行（全交易所聚合） */
export interface CoinGlassLiquidationCoin {
  symbol: string;
  liquidation_usd_1h: number;
  long_liquidation_usd_1h: number;
  short_liquidation_usd_1h: number;
  liquidation_usd_24h: number;
  long_liquidation_usd_24h: number;
  short_liquidation_usd_24h: number;
}

/** /api/futures/liquidation/history 的一根。金额是字符串，调用方负责 parseFloat。 */
export interface CoinGlassLiquidationBar {
  time: number;
  long_liquidation_usd: string;
  short_liquidation_usd: string;
}

/** /api/futures/price/history 的一根。OHLCV 全是字符串。 */
export interface CoinGlassPriceBar {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_usd: string;
}

/** /api/futures/taker-buy-sell-volume/history 的一根 */
export interface CoinGlassTakerBar {
  time: number;
  taker_buy_volume_usd: string;
  taker_sell_volume_usd: string;
}

/** /api/futures/funding-rate/exchange-list 的一行 */
export interface CoinGlassFundingRow {
  symbol: string;
  stablecoin_margin_list?: Array<{ exchange: string; funding_rate: number }>;
}
