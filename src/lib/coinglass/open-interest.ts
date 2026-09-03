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
 * **最后一根是「此刻」的实时快照，不是收盘值**（2026-09-04 实测，SOL 30m，
 * 间隔 90 秒拉两次）：
 *
 *   15:00  6550058695  → 6550058695   已收盘，一字未动
 *   15:30  6588029677  → 6588029677   已收盘，一字未动
 *   16:00  6523879795  → 6516489075   **当前这根，90 秒漂了 -0.11%**
 *
 * 已收盘的那些是定死的，只有当前周期那一根在动。而扫描每 15 分钟一轮、
 * K 线是 30 分钟一根，所以**最后一根永远是没走完的那根**。
 *
 * 两个下游后果，都在 factors/scenario.ts 与 ignition.ts 里：
 *   ① leg(ctx, from, ctx.last) 的 oiPct/oiState 会随扫描时刻漂。90 秒 0.11%
 *      的量级意味着一根 K 线内足以跨过 OI_FLAT_PCT(1%) 那条线，于是同一根
 *      K 线上 oiState 可能 flat ↔ up 来回跳，卡片的名字、操作文案、强度徽章
 *      跟着变。
 *   ② 点火的 OI 门（oiChangeAt(oiBars, origin)）在 barsAgo=0 时读的正是这根，
 *      也就是「距上一根收盘以来 OI 涨了没」——含义是成立的，但它覆盖的时长
 *      取决于扫描落在这根 K 线的第几分钟（1 分钟到 29 分钟不等）。
 *
 * **没有改成只用已收盘的那根**，因为 OI 是**存量**不是流量：当前快照就是
 * 此刻最真实的持仓水平，丢掉它换来的是最多 30 分钟的滞后，而这跟「尽早抓到」
 * 这个目标是直接冲突的（摆动点半窗刚从 5 降到 2 就是为了砍滞后）。
 * 要改的前提是回测能证明这种抖动确实在伤害结果，而不是仅仅看着难受。
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
