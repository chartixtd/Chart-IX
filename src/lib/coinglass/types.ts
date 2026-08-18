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
 * /api/futures/open-interest/aggregated-history 的一根。
 *
 * OHLC **不是**统一字符串（这一点和 price/history 不一样，也是 T20 review
 * F1 指出的问题）：真实响应里同一根 K 线的字段类型是混的，实测样本
 * `{"open":"45714242","high":45740423.0381,"low":"45714242","close":45740423.0381}`
 * ——open/low 是字符串，high/close 是 number。没有理由假设某个字段在所有
 * 币种、所有时刻上永远是同一种类型，所以四个字段都声明成 `string | number`。
 * 读取时统一走 `toFiniteNumber`，不要用 `parseFloat` 的隐式 ToString 蒙混过去
 * （那样能跑通，但 tsc 的「零错误」验证的是一个和生产环境不符的假想类型）。
 * 没有 volume_usd（这个端点不提供成交量）。
 */
export interface CoinGlassOiBar {
  time: number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
}

/**
 * CoinGlass 有些端点在同一根 K 线里混用字符串和数字（见 CoinGlassOiBar 顶部
 * 注释的实测样本）。数字直接用，字符串走 parseFloat，取不到有限值统一返回
 * NaN，交给调用处已有的 `Number.isFinite` 守卫拦截——不要在这里抛错，
 * OI 因子对单个坏点的容忍策略是「跳过/给中性分」，不是「整轮扫描炸掉」。
 */
export function toFiniteNumber(v: string | number): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
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
