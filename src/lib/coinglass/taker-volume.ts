import { coinglassGet } from "./client";
import type { CoinGlassTakerBar } from "./types";
import { SERIES_INTERVAL } from "./price-history";

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
 * 14 天 = 672 根 30 分钟。量能比的分母需要这么长。
 *
 * 上游给不给足这么多根不由我们决定，所以下游一律**按实际拿到的根数**折算
 * 天数（见 volume-ratio.ts），不要写死 14。真只给了 336 根，量能比就是
 * 7 天口径——含义仍然成立，只是窗口短一点。
 */
export const TAKER_HISTORY_LIMIT = 672;

/**
 * 把 taker 序列裁成与价格 K 线**逐根对齐**的等长数组。
 *
 * 按时间戳配对，不按「取最后 N 根」——后者只在两条序列末尾恰好同一时刻、
 * 中间一根不缺时才成立，而这两个前提都不由我们控制。缺失的那一根填 0/0：
 * classifySide 会因为 gross ≤ 0 直接返回 null，也就是「这段判不出场景」，
 * 这正是缺数据时该有的行为——比拿相邻一根顶上去要诚实。
 */
export function alignTakerToPrice(
  taker: CoinGlassTakerBar[],
  priceBars: Array<{ time: number }>
): CoinGlassTakerBar[] {
  const byTime = new Map<number, CoinGlassTakerBar>();
  for (const b of taker) byTime.set(b.time, b);
  return priceBars.map(
    (p) =>
      byTime.get(p.time) ?? {
        time: p.time,
        aggregated_buy_volume_usd: 0,
        aggregated_sell_volume_usd: 0,
      }
  );
}

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
 * **这条序列比价格/OI 长**：14 天（672 根），而那两条是 7 天（336 根）。
 * 多出来的一倍只服务一件事——量能比要拿「最近 24 小时」去比「14 天日均」
 * （见 screener/volume-ratio.ts）。拉长不额外花调用，同一次请求而已。
 *
 * **代价是逐根对齐没了。** 六场景判定用价格摆动点的下标去取 buys[i]/sells[i]
 * （见 factors/scenario.ts 的 classifySide），三条序列同下标同时刻是它成立的
 * 前提。序列一长一短，同一个下标就指到 7 天前去了，而且**不会报错**，
 * 只会把每个币的场景判定悄悄算错。所以喂给场景/CVD 之前必须先过
 * alignTakerToPrice()，不要直接把这个函数的返回值传下去。
 */
export function getTakerVolumeHistory(coin: string): Promise<CoinGlassTakerBar[]> {
  return coinglassGet<CoinGlassTakerBar[]>(
    "/api/futures/aggregated-taker-buy-sell-volume/history",
    {
      symbol: coin,
      interval: SERIES_INTERVAL,
      limit: TAKER_HISTORY_LIMIT,
      exchange_list: CVD_EXCHANGES.join(","),
    }
  );
}
