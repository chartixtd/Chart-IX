import { coinglassGet } from "./client";
import type { CoinGlassOpenInterestRow } from "./types";

/**
 * 持仓量快照。这个端点不受 Startup 套餐的 30 分钟 K 线粒度限制，
 * 直接给 5m/15m/30m/1h/4h/24h 六个窗口的变化率——OI 因子要的新鲜度
 * 全靠它，不要改成去拉 open-interest/history 序列。
 */
export function getOpenInterestExchangeList(coin: string): Promise<CoinGlassOpenInterestRow[]> {
  return coinglassGet<CoinGlassOpenInterestRow[]>("/api/futures/open-interest/exchange-list", {
    symbol: coin,
  });
}

/**
 * 只认 exchange === "All" 这一行。小市值币在单个交易所的持仓量噪音极大，
 * 聚合才是真实杠杆水位。拿不到 All 就返回 undefined 让 OI 因子走中性分，
 * 绝不退而求其次拿某一家顶替——那会让不同币的 OI 分在描述不同的市场。
 */
export function pickAggregatedOi(
  rows: CoinGlassOpenInterestRow[]
): CoinGlassOpenInterestRow | undefined {
  return rows.find((r) => r.exchange === "All");
}
