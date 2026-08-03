import type { BingXTicker } from "@/types/bingx";
import type { MarketCapEntry, MarketCapMap } from "@/lib/market-cap";
import {
  getMarketCapScore,
  stripContractMultiplier,
  TOP_MARKET_CAP_EXCLUDED,
  MARKET_CAP_FALLBACK_SCORE,
} from "@/lib/market-cap";

export type Direction = "long" | "short";

/** screener 自动重新筛选间隔：1 小时 */
export const SCREENER_REFRESH_MS = 3_600_000;

/** 每个方向输出的条数 */
export const GROUP_SIZE = 10;

const MIN_QUOTE_VOLUME = 1_000_000;
const MIN_AMPLITUDE = 1.5;
const MAX_CHASE_PERCENT = 15;

export interface ScreenerResult {
  symbol: string;
  lastPrice: number;
  /** 真 24h 涨跌（来自现货 ticker）；关联不到对应现货交易对时为 null，表格应显示 "-" */
  priceChangePercent: number | null;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  amplitude: number;
  marketCap: number | null;
  marketCapRank: number | null;
  openInterest: number;
  fundingRate: number;
  oiVolumeRatio: number;
  score: number;
}

export interface ScreenerGroups {
  long: ScreenerResult[];
  short: ScreenerResult[];
}

interface Parsed {
  high: number;
  low: number;
  last: number;
  quoteVolume: number;
  amplitude: number;
}

function parse(ticker: BingXTicker): Parsed | null {
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const last = Number(ticker.lastPrice);
  const quoteVolume = parseFloat(ticker.quoteVolume);

  if (![high, low, last, quoteVolume].every(Number.isFinite)) return null;
  if (low <= 0) return null;

  return { high, low, last, quoteVolume, amplitude: ((high - low) / low) * 100 };
}

/**
 * 合约 ticker 的 priceChangePercent 只覆盖约 3 分钟，不能当 24h 用；
 * 现货 ticker 才是真 24h（实测 openTime->closeTime 正好 1440 分钟）。
 * 这里按「剥掉乘数前缀后的 symbol」把现货 24h 涨跌关联到合约上，
 * 关联不到的合约不进 map —— 上层据此走中性分、且不做追高淡汰。
 *
 * 注意现货接口返回的是带百分号的字符串（如 "0.47%"），parseFloat 会正确截断。
 */
export function buildChange24hMap(
  futuresTickers: BingXTicker[],
  spotTickers: BingXTicker[]
): Record<string, number> {
  const spotBySymbol = new Map<string, number>();
  for (const spot of spotTickers) {
    const pct = parseFloat(String(spot.priceChangePercent));
    if (Number.isFinite(pct)) spotBySymbol.set(spot.symbol, pct);
  }

  const map: Record<string, number> = {};
  for (const futures of futuresTickers) {
    const pct = spotBySymbol.get(stripContractMultiplier(futures.symbol));
    if (pct !== undefined) map[futures.symbol] = pct;
  }
  return map;
}

/** 硬性淘汰：触发任一规则返回 true（淘汰） */
export function hardFilter(
  ticker: BingXTicker,
  direction: Direction,
  change24h: number | undefined
): boolean {
  const p = parse(ticker);
  if (!p) return true;
  if (p.quoteVolume < MIN_QUOTE_VOLUME) return true;
  if (p.amplitude < MIN_AMPLITUDE) return true;
  if (change24h !== undefined) {
    if (direction === "long" && change24h > MAX_CHASE_PERCENT) return true;
    if (direction === "short" && change24h < -MAX_CHASE_PERCENT) return true;
  }
  return false;
}

/** 市值排名进前 50 的主流大币排除出候选池；查不到市值的不算大币 */
export function isExcludedByMarketCap(entry: MarketCapEntry | undefined): boolean {
  return entry !== undefined && entry.rank <= TOP_MARKET_CAP_EXCLUDED;
}

/**
 * BingX 在永续里混了一批代币化的股票/商品/指数/外汇（NCSK=股票、NCCO=商品、
 * NCSI=指数、NCFX=外汇），它们不是加密货币，不该出现在小市值币筛选器里。
 * 这些标的在 CoinGecko 查不到市值，会走「查不到=微型盘」那条路白拿 25% 权重的
 * 满分，实测能把 Tesla、Oracle 这种直接顶上榜首。
 * 用四个明确前缀而不是裸 "NC"，避免误伤 NCASH 这类真实币种。
 */
export function isSyntheticProduct(symbol: string): boolean {
  return /^NC(SK|CO|SI|FX)/.test(symbol);
}

/** 做多池与做空池的并集，供上层按需拉 OI/资金费率 */
export function selectCandidateSymbols(
  tickers: BingXTicker[],
  marketCapMap: MarketCapMap | null,
  change24hMap: Record<string, number> = {}
): string[] {
  const symbols = new Set<string>();
  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith("-USDT")) continue;
    if (isSyntheticProduct(ticker.symbol)) continue;
    const capKey = stripContractMultiplier(ticker.symbol);
    if (marketCapMap && isExcludedByMarketCap(marketCapMap[capKey])) continue;
    const change24h = change24hMap[ticker.symbol];
    if (!hardFilter(ticker, "long", change24h) || !hardFilter(ticker, "short", change24h)) {
      symbols.add(ticker.symbol);
    }
  }
  return [...symbols];
}

function amplitudeScore(amplitude: number): number {
  if (amplitude >= 2 && amplitude <= 5) return 100;
  if (amplitude >= MIN_AMPLITUDE && amplitude < 2) return ((amplitude - MIN_AMPLITUDE) / 0.5) * 100;
  if (amplitude > 5 && amplitude <= 12) return 100 - ((amplitude - 5) / 7) * 100;
  return 0;
}

/**
 * 反转逻辑：费率为负说明空头在付钱给多头（空头拥挤），对做多有利；反之亦然。
 * ±0.05% 是这里的饱和阈值。
 */
function fundingScore(fundingRate: number, direction: Direction): number {
  if (!Number.isFinite(fundingRate)) return 50;
  const signed = direction === "long" ? -fundingRate : fundingRate;
  if (signed >= 0.0005) return 100;
  if (signed <= -0.0005) return 0;
  return ((signed + 0.0005) / 0.001) * 100;
}

function oiRatioScore(ratio: number): number {
  if (ratio >= 0.3 && ratio <= 1.5) return 100;
  if (ratio < 0.3) return (ratio / 0.3) * 100;
  if (ratio <= 3) return 100 - ((ratio - 1.5) / 1.5) * 100;
  return 0;
}

/** 要有顺方向动量，但不能已经跑太远——3% 附近是甜点，越接近淘汰线 15% 分越低。
 *  拿不到 24h 涨跌时给中性分，不奖不罚。 */
function momentumScore(change24h: number | undefined, direction: Direction): number {
  if (change24h === undefined || !Number.isFinite(change24h)) return 50;
  const signed = direction === "long" ? change24h : -change24h;
  if (signed <= 0) return 0;
  if (signed <= 3) return (signed / 3) * 100;
  if (signed <= MAX_CHASE_PERCENT) return 100 - ((signed - 3) / (MAX_CHASE_PERCENT - 3)) * 100;
  return 0;
}

/** 做多希望价格在日内区间的偏下半段（不接飞刀也不追高），做空反之 */
function positionScore(p: Parsed, direction: Direction): number {
  const raw = p.high > p.low ? (p.last - p.low) / (p.high - p.low) : 0.5;
  const clamped = Math.max(0, Math.min(1, raw));
  const eff = direction === "long" ? clamped : 1 - clamped;
  if (eff >= 0.2 && eff <= 0.5) return 100;
  if (eff < 0.2) return (eff / 0.2) * 100;
  return 100 - ((eff - 0.5) / 0.5) * 100;
}

function scoreToken(
  p: Parsed,
  direction: Direction,
  openInterest: number,
  fundingRate: number,
  marketCapScore: number,
  change24h: number | undefined
): number {
  const oiRatio = p.quoteVolume > 0 ? openInterest / p.quoteVolume : 0;
  return Math.round(
    marketCapScore * 0.25 +
      amplitudeScore(p.amplitude) * 0.2 +
      fundingScore(fundingRate, direction) * 0.2 +
      oiRatioScore(oiRatio) * 0.15 +
      momentumScore(change24h, direction) * 0.1 +
      positionScore(p, direction) * 0.1
  );
}

function buildGroup(
  tickers: BingXTicker[],
  direction: Direction,
  oiMap: Record<string, number>,
  frMap: Record<string, number>,
  marketCapMap: MarketCapMap | null,
  change24hMap: Record<string, number>
): ScreenerResult[] {
  const rows: ScreenerResult[] = [];

  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith("-USDT")) continue;
    if (isSyntheticProduct(ticker.symbol)) continue;

    const entry = marketCapMap?.[stripContractMultiplier(ticker.symbol)];
    if (marketCapMap && isExcludedByMarketCap(entry)) continue;
    const change24h = change24hMap[ticker.symbol];
    if (hardFilter(ticker, direction, change24h)) continue;

    const p = parse(ticker);
    if (!p) continue;

    const openInterest = oiMap[ticker.symbol] ?? 0;
    const fundingRate = frMap[ticker.symbol] ?? 0;
    const marketCapScore = marketCapMap ? getMarketCapScore(entry) : MARKET_CAP_FALLBACK_SCORE;

    rows.push({
      symbol: ticker.symbol,
      lastPrice: p.last,
      priceChangePercent: change24h ?? null,
      highPrice: p.high,
      lowPrice: p.low,
      quoteVolume: p.quoteVolume,
      amplitude: p.amplitude,
      marketCap: entry?.marketCap ?? null,
      marketCapRank: entry?.rank ?? null,
      openInterest,
      fundingRate,
      oiVolumeRatio: p.quoteVolume > 0 ? openInterest / p.quoteVolume : 0,
      score: scoreToken(p, direction, openInterest, fundingRate, marketCapScore, change24h),
    });
  }

  return rows.sort((a, b) => b.score - a.score).slice(0, GROUP_SIZE);
}

/** 一次算出做多优势 / 做空优势两组 Top N */
export function computeScreenerGroups(
  tickers: BingXTicker[],
  oiMap: Record<string, number>,
  frMap: Record<string, number>,
  marketCapMap: MarketCapMap | null,
  change24hMap: Record<string, number> = {}
): ScreenerGroups {
  return {
    long: buildGroup(tickers, "long", oiMap, frMap, marketCapMap, change24hMap),
    short: buildGroup(tickers, "short", oiMap, frMap, marketCapMap, change24hMap),
  };
}
