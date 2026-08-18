import { coinglassGet } from "./client";
import type { CoinGlassPairMarket, CoinGlassFundingRow } from "./types";

/** 一个币在所有交易所的合约行情。Startup 套餐没有全币批量端点，只能逐币调。 */
export function getPairsMarkets(coin: string): Promise<CoinGlassPairMarket[]> {
  return coinglassGet<CoinGlassPairMarket[]>("/api/futures/pairs-markets", { symbol: coin });
}

/** 全币资金费率，一次调用拿全（约 2MB）。 */
export function getFundingRateList(): Promise<CoinGlassFundingRow[]> {
  return coinglassGet<CoinGlassFundingRow[]>("/api/futures/funding-rate/exchange-list");
}

/**
 * 按交易所挑一行，挑不到就回落到成交额最大的那家。
 *
 * 回落而不是返回 undefined 是刻意的：BingX 上有一批币在 Binance 没有合约，
 * 如果没有回落，这些币的 K 线/CVD 会整块缺失、四因子里三个走缺失分支，
 * 等于把「Binance 没上市」误读成「这个币没有信号」。
 */
export function pickExchangeRow<T extends { exchange_name: string; volume_usd: number }>(
  rows: T[],
  preferred: string
): T | undefined {
  const exact = rows.find((r) => r.exchange_name === preferred);
  if (exact) return exact;
  return rows.reduce<T | undefined>(
    (best, r) => (best === undefined || r.volume_usd > best.volume_usd ? r : best),
    undefined
  );
}
