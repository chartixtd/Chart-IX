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

/** 市值排名在这个名次以内的币视为主流大币，排除出候选池 */
export const TOP_MARKET_CAP_EXCLUDED = 50;

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
