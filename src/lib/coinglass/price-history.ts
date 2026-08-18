import { coinglassGet } from "./client";
import type { CoinGlassPriceBar } from "./types";

/**
 * Startup 套餐支持的最细粒度。服务端在 403 里直接返回了白名单：
 * ["30m","1h","2h","4h","6h","8h","12h","1d","1w"]，15m 及以下一律拒绝。
 * 不要改成 "15m"——那会让明细层每个币都 403，四因子里三个整块失效。
 */
export const SERIES_INTERVAL = "30m";

/** 近 24 小时 = 48 根 30 分钟。CVD 与 Sweep 共用这个长度。 */
export const SERIES_LIMIT = 48;

/** 7 天 = 336 根 30 分钟。Zone 的成交量分布要这么长才有意义。 */
export const PRICE_HISTORY_LIMIT = 336;

/**
 * 一根 7 天 30m 的 K 线同时喂四处：Zone 的成交量分布、Sweep 的收回确认、
 * OI 的同窗口价格变化、以及展示用的真 24h 振幅。不要为了其中某一个
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
