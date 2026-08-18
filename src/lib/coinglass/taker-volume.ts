import { coinglassGet } from "./client";
import type { CoinGlassTakerBar } from "./types";
import { SERIES_INTERVAL, SERIES_LIMIT } from "./price-history";

/** 近 24 小时的主动买/卖成交额，CVD 的唯一数据源。 */
export function getTakerVolumeHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassTakerBar[]> {
  return coinglassGet<CoinGlassTakerBar[]>("/api/futures/taker-buy-sell-volume/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: SERIES_LIMIT,
  });
}
