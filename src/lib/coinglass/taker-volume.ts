import { coinglassGet } from "./client";
import type { CoinGlassTakerBar } from "./types";
import { SERIES_INTERVAL, PRICE_HISTORY_LIMIT } from "./price-history";

/**
 * 主动买/卖成交额，CVD 因子与六场景判定的唯一数据源。
 *
 * limit 从 SERIES_LIMIT(48) 改成 PRICE_HISTORY_LIMIT(336)：六场景判定
 * （factors/scenario.ts）要在摆动点对之间算 CVD 净流占比，而摆动点可能
 * 落在 7 天内任何位置，所以这条序列要跟价格、OI 两条序列一样长——
 * 三条序列同下标同时刻是背离/场景判定成立的前提（已实测三条序列
 * 30m 粒度下逐根时间戳一致）。调用次数不变，只是这一次调用拉的根数
 * 变多。CVD 因子本身（factors/cvd.ts 的 cvdNorm）不受影响：它只取
 * 序列末尾 CVD_WINDOW_BARS(12) 根，序列变长对它是透明的。
 */
export function getTakerVolumeHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassTakerBar[]> {
  return coinglassGet<CoinGlassTakerBar[]>("/api/futures/taker-buy-sell-volume/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: PRICE_HISTORY_LIMIT,
  });
}
