import { coinglassGet } from "./client";
import type { CoinGlassOiBar } from "./types";
import { SERIES_INTERVAL, PRICE_HISTORY_LIMIT } from "./price-history";

/**
 * 持仓量序列（全交易所聚合）。换成序列而不是原来的快照端点
 * （open-interest/exchange-list），是因为 T20 要给 OI 因子加背离判断：
 * 象限部分需要在同一条序列上按 barsBack 逐根算变化率，背离判断需要
 * 在整条 7 天序列上找摆动点——快照只给六个滚动窗口的变化率，两件事
 * 都做不了。
 *
 * 已实测：这个端点**不需要** exchange_list 参数（同系列的 liquidation/
 * orderbook 的 aggregated 版本需要，这个不需要）；最新一根与
 * exchange-list 里 exchange==="All" 那一行完全一致（VELVET 实测
 * 56704723 vs 56704722.79），是同一份聚合数据。
 *
 * 粒度与长度复用 price-history 的常量，让它和价格序列逐根对齐——
 * OI 因子的背离判断依赖「同下标 = 同时刻」，长度和粒度对不上这个前提
 * 就不成立（见 factors/oi-divergence.ts 里 oiDivergence 的长度校验）。
 * 调用次数不变，仍是每币一次。
 */
export function getOpenInterestHistory(coin: string): Promise<CoinGlassOiBar[]> {
  return coinglassGet<CoinGlassOiBar[]>("/api/futures/open-interest/aggregated-history", {
    symbol: coin,
    interval: SERIES_INTERVAL,
    limit: PRICE_HISTORY_LIMIT,
  });
}
