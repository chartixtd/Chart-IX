import { coinglassGet } from "./client";
import type { CoinGlassLiquidationCoin, CoinGlassLiquidationBar } from "./types";
import { SERIES_INTERVAL, SERIES_LIMIT } from "./price-history";

/** 全币爆仓（1h/4h/12h/24h，全交易所聚合），一次调用拿全。 */
export function getLiquidationCoinList(): Promise<CoinGlassLiquidationCoin[]> {
  return coinglassGet<CoinGlassLiquidationCoin[]>("/api/futures/liquidation/coin-list");
}

/** 近 24 小时的 30 分钟爆仓序列。Startup 套餐拿不到比 30m 更细的粒度。 */
export function getLiquidationHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassLiquidationBar[]> {
  return coinglassGet<CoinGlassLiquidationBar[]>("/api/futures/liquidation/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: SERIES_LIMIT,
  });
}
