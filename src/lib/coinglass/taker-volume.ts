import { coinglassGet } from "./client";
import type { CoinGlassTakerBar } from "./types";
import { SERIES_INTERVAL, PRICE_HISTORY_LIMIT } from "./price-history";

/**
 * CVD 的采样交易所。
 *
 * 四家的选择对齐 CoinGlass 网页版 Aggregated Futures CVD 指标的默认勾选，
 * 目的是让用户在 CoinGlass 图上看到的 CVD 和这里算出来的是同一份数据——
 * 对不上的话，用户拿图去核对 screener 的结论时只会得到互相矛盾的两个答案。
 *
 * 实测过「换成四家会不会改变 CVD 的分布」：同样 13 个币、同样 336 根，
 * Binance 单家与四家聚合的 |净流/总量| 分布几乎重合（中位 0.0594 vs 0.0563、
 * 99% 分位 0.3067 vs 0.3018）。所以换源**不是**为了改变打分口径，
 * 而是为了两件具体的事：
 *
 *   1. **覆盖率。** BingX 上 534 个可扫的永续里有 71 个（13.3%）在 Binance
 *      根本没有合约，此前这些币的 CVD 完全拿不到；四家并集把缺口降到 51 个
 *      （9.6%），补回 CORE / MNT / OKB / CRO / WAVES 这类真实候选。
 *   2. **单位。** 见 CoinGlassTakerBar 的注释——旧端点的 `_usd` 字段其实是
 *      币的数量。
 *
 * 每币调用次数不变，仍是 1 次。
 */
export const CVD_EXCHANGES = ["Binance", "Bybit", "OKX", "Hyperliquid"] as const;

/**
 * 主动买/卖成交额（多交易所聚合），CVD 因子与六场景判定的唯一数据源。
 *
 * 用 `symbol=<币名>` 而不是交易所的合约 id —— 这顺带去掉了「先在
 * pairs-markets 里找到某家交易所的 instrument_id 才能拉资金流」这层依赖，
 * 是上面第 1 条覆盖率提升能成立的原因。
 *
 * `exchange_list` 是**必填**的（不传返回 code 400），而且实测真的生效
 * （BTC 同一根：仅 Binance 买额 2.27B、四家 4.77B）。这一点和 OI 的
 * aggregated-history 相反——那个端点会把 exchange_list 静默忽略，
 * 见 open-interest.ts。
 *
 * limit 与粒度复用 price-history 的常量，让它和价格、OI 两条序列逐根对齐——
 * 三条序列同下标同时刻是背离/场景判定成立的前提。
 */
export function getTakerVolumeHistory(coin: string): Promise<CoinGlassTakerBar[]> {
  return coinglassGet<CoinGlassTakerBar[]>(
    "/api/futures/aggregated-taker-buy-sell-volume/history",
    {
      symbol: coin,
      interval: SERIES_INTERVAL,
      limit: PRICE_HISTORY_LIMIT,
      exchange_list: CVD_EXCHANGES.join(","),
    }
  );
}
