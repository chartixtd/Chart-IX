import { coinglassGet } from "./client";
import type { CoinGlassPriceBar } from "./types";

/**
 * Startup 套餐支持的最细粒度。服务端在 403 里直接返回了白名单：
 * ["30m","1h","2h","4h","6h","8h","12h","1d","1w"]，15m 及以下一律拒绝。
 * 不要改成 "15m"——那会让明细层每个币都 403，OI 与 CVD 两个因子整块失效。
 */
export const SERIES_INTERVAL = "30m";

/**
 * 近 24 小时 = 48 根 30 分钟。CVD 的回归窗口（CVD_WINDOW_BARS=12）与展示用
 * 的真 24h 振幅共用这个长度。T21 退役 Sweep 之前这里还给 Sweep 用过，
 * 现在只剩这两处消费者。
 */
export const SERIES_LIMIT = 48;

/**
 * 7 天 = 336 根 30 分钟。OI 因子的背离摆动点识别（oi-divergence.ts 的
 * PIVOT_N）要这么长才能可靠找到确认过的高低点。T21 退役 Zone 之前这里
 * 还给 Zone 的成交量分布用过，现在这个长度是 OI 背离在撑着，不要因为
 * 「Zone 没了」就把它缩短。
 */
export const PRICE_HISTORY_LIMIT = 336;

/**
 * 一根 7 天 30m 的 K 线同时喂三处：OI 的同窗口价格变化与背离摆动点识别、
 * CVD 的回归窗口与背离判断、以及展示用的真 24h 振幅。不要为了其中某一个
 * 再拉第二次——那是每轮多 150 次上游调用。
 */
export function getPriceHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassPriceBar[]> {
  return coinglassGet<CoinGlassPriceBar[]>("/api/futures/price/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: PRICE_HISTORY_LIMIT,
  });
}
