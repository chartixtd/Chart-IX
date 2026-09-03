/** CoinGecko /coins/markets 响应里我们唯一用到的三个字段 */
export interface CoinGeckoMarketRow {
  symbol: string;
  market_cap: number | null;
  market_cap_rank: number | null;
}

export interface MarketCapEntry {
  marketCap: number;
  rank: number;
}

/** key 形如 "PEPE-USDT"，与 BingX 永续合约 symbol 对齐 */
export type MarketCapMap = Record<string, MarketCapEntry>;

/**
 * 只用来验「CoinGecko 第 1 页有没有拉到」的探针名次，**不是**一条筛选门槛。
 *
 * 这里曾经是 TOP_MARKET_CAP_EXCLUDED——市值排名前 50 的币会被排除出候选池。
 * 那条规则已经去掉：候选池现在只受市值下限（3000万）与成交量门槛约束，
 * 没有上限，BTC/ETH 这类大币只要满足其余条件就能进。
 *
 * 名字改掉是必须的：一个叫「EXCLUDED」的常量在没有任何东西被 exclude 之后
 * 还留在代码里，下一个读它的人（包括几个月后的我）会以为筛选逻辑还在。
 */
export const TOP_RANK_COVERAGE_PROBE = 50;

/**
 * 市值与全量行情的客户端刷新节奏，1 小时。
 *
 * 原先这两处借用 screener 的刷新间隔，但 screener 已改成 15 分钟一扫，
 * 继续共用会让市值和全量 ticker 也变成 15 分钟一拉——市值一小时才变一次，
 * 那是纯粹多打 3 倍的 CoinGecko 请求（免密钥档限流很凶）。
 */
export const MARKET_CAP_REFRESH_MS = 3_600_000;

/** 市值数据整体拿不到时，市值维度统一给的中性分 */
export const MARKET_CAP_FALLBACK_SCORE = 50;

const MARKET_CAP_FLOOR = 10_000_000;
const MARKET_CAP_CEILING = 2_000_000_000;

/**
 * 输入必须是按 market_cap_desc 排序的原始行：同一个 ticker 被多个币占用时，
 * 先出现的（市值最高的）才是我们要对应到 BingX 交易对上的那个。
 */
export function buildMarketCapMap(rows: CoinGeckoMarketRow[]): MarketCapMap {
  const map: MarketCapMap = {};
  for (const row of rows) {
    if (row.market_cap === null || row.market_cap <= 0) continue;
    if (row.market_cap_rank === null) continue;
    const key = `${row.symbol.toUpperCase()}-USDT`;
    if (map[key]) continue;
    map[key] = { marketCap: row.market_cap, rank: row.market_cap_rank };
  }
  return map;
}

/**
 * CoinGecko 的第 1 页装着排名 1-250。少了它，大币会变成"查不到市值"——
 * 而"查不到市值"在 getMarketCapScore 里是**满分**（当极小盘处理），
 * 于是一份缺了头部的名单会让 BTC 拿到极小盘的分数，前端毫无察觉。
 * 宁可整体失败让前端走中性分兜底。
 */
export function hasTopRankCoverage(rows: CoinGeckoMarketRow[]): boolean {
  return rows.some(
    (row) => row.market_cap_rank !== null && row.market_cap_rank <= TOP_RANK_COVERAGE_PROBE
  );
}

/** 市值越小分越高。查不到市值的币按极小盘处理，给满分。 */
export function getMarketCapScore(entry: MarketCapEntry | undefined): number {
  if (!entry) return 100;
  const cap = entry.marketCap;
  if (cap <= MARKET_CAP_FLOOR) return 100;
  if (cap >= MARKET_CAP_CEILING) return 0;
  const t =
    (Math.log10(cap) - Math.log10(MARKET_CAP_FLOOR)) /
    (Math.log10(MARKET_CAP_CEILING) - Math.log10(MARKET_CAP_FLOOR));
  return 100 - t * 100;
}

export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * BingX 对低价币用合约乘数命名（1000PEPE-USDT 就是 PEPE 的千倍合约）。
 * 剥掉这个乘数前缀是一个通用需求：查市值时代币本身的属性与合约乘数无关；
 * 关联现货 24h 涨跌时现货交易对也不带这个乘数前缀。两处都要先剥前缀再关联。
 * 只剥 1 后面跟 3 个以上 0 的形式；1INCH、0G、2Z、4 这些是真实币名，不能动。
 */
export function stripContractMultiplier(symbol: string): string {
  return symbol.replace(/^10{3,}(?=[A-Z])/, "");
}
