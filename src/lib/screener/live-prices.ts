import type { BingXTicker } from "@/types/bingx";

/**
 * 警报卡实时价格的刷新间隔。
 *
 * 刻意**不**跟 SCAN_INTERVAL_MS 走。扫描 15 分钟一轮是被 CoinGlass 的
 * 80 次/分钟配额逼出来的节奏，而这里取的是 BingX 的公开行情——不花配额、
 * 一次调用拿回全部 symbol，没有理由让它陪着扫描一起慢。
 *
 * 15 秒是取舍点：再快对日内判断没有增量信息，再慢就又变回「看着不动」。
 */
export const LIVE_PRICE_REFRESH_MS = 15_000;

/** 服务端缓存窗口。比刷新间隔略短，保证客户端每次轮询都能拿到新值而不是同一份。 */
export const LIVE_PRICE_TTL_MS = 10_000;

export interface LivePricePayload {
  /** BingX 永续 symbol（含 -USDT 后缀，与 AlertRecord.symbol 同形）→ 最新成交价 */
  prices: Record<string, number>;
  /** 服务端取到这份行情的时刻，ms epoch */
  at: number;
}

/**
 * BingX 全量 ticker → symbol/价格映射。
 *
 * 只保留 -USDT 永续并跳过非法价格：警报卡拿不到价格时会回落到
 * lastPrice（上一轮扫描的值），这比显示一个 NaN 或 0 好——0 会让
 * signedPct 算出 -100%，在卡片上是一个刺眼且完全错误的数字。
 */
export function buildPriceMap(tickers: BingXTicker[], at: number): LivePricePayload {
  const prices: Record<string, number> = {};
  for (const t of tickers) {
    if (!t.symbol.endsWith("-USDT")) continue;
    const p = typeof t.lastPrice === "number" ? t.lastPrice : parseFloat(t.lastPrice);
    if (!Number.isFinite(p) || p <= 0) continue;
    prices[t.symbol] = p;
  }
  return { prices, at };
}
