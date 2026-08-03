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

/**
 * 流动性在这个模型里是纯门槛而不是打分维度（它和小市值目标直接冲突）。
 * 旧模型有一条 25% 权重的流动性斜坡在补偿 100 万这个低门槛，现在没有任何东西补偿了：
 * 100 万日成交折合每小时约 4 万美元换手，做日内短线根本吃不下量。
 *
 * 700 万这个数不是拍脑袋，别往回调：BingX 长尾的 quoteVolume 是被拍平的
 * （实测 516 个真实加密货币永续里有 144 个全挤在 619-691 万这个 0.73M 宽的带里，
 * 真实成交量不可能这么分布），5M 门槛会正好卡进这段假数据中间，
 * 放进来的 182 个候选里 144 个成交量根本不可信。7M 刚好跨过整条假带，
 * 剩下 40 个候选，成交量才是可信的——挑两组各 10 个绰绰有余。
 * 头部是正常的（BTC 557M、ETH 383M、SOL 167M、AAVE 56M，衰减合理），只有长尾被夹住。
 */
export const MIN_QUOTE_VOLUME = 7_000_000;
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
  /** 持仓量请求失败/缺失时为 null（区别于真的是 0），表格应显示 "-" */
  openInterest: number | null;
  fundingRate: number;
  /** openInterest 为 null 时同样为 null，表格应显示 "-" */
  oiVolumeRatio: number | null;
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

/** 持仓量拿不到时（请求失败，而不是真的是 0）给中性 50，别让排名按请求运气重排。 */
function oiRatioScore(ratio: number | undefined): number {
  if (ratio === undefined || !Number.isFinite(ratio)) return 50;
  if (ratio >= 0.3 && ratio <= 1.5) return 100;
  if (ratio < 0.3) return (ratio / 0.3) * 100;
  if (ratio <= 3) return 100 - ((ratio - 1.5) / 1.5) * 100;
  return 0;
}

/** 要有顺方向动量，但不能已经跑太远——+3% 是甜点。
 *  走平给中性 50，逆向越深越低，追高越远越低；拿不到数据同样给 50，不奖不罚。 */
function momentumScore(change24h: number | undefined, direction: Direction): number {
  if (change24h === undefined || !Number.isFinite(change24h)) return 50;
  const signed = direction === "long" ? change24h : -change24h;
  if (signed <= -MAX_CHASE_PERCENT) return 0;
  if (signed < 0) return 50 + (signed / MAX_CHASE_PERCENT) * 50;
  if (signed <= 3) return 50 + (signed / 3) * 50;
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

/** 返回未取整的原始分。取整只在写进 ScreenerResult.score 时做——见 buildGroup。 */
function scoreToken(
  p: Parsed,
  direction: Direction,
  oiRatio: number | undefined,
  fundingRate: number,
  marketCapScore: number,
  change24h: number | undefined
): number {
  return (
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
  // 先按未取整的原始分排序，取整只在最后写进 score 时做：
  // 六条曲线里有四条带平台段，整数打平很常见，先取整会让第 10 名的切分
  // 由 BingX 返回数组的顺序决定，而不是由分数决定。
  const scored: { raw: number; row: Omit<ScreenerResult, "score"> }[] = [];

  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith("-USDT")) continue;
    if (isSyntheticProduct(ticker.symbol)) continue;

    const entry = marketCapMap?.[stripContractMultiplier(ticker.symbol)];
    if (marketCapMap && isExcludedByMarketCap(entry)) continue;
    const change24h = change24hMap[ticker.symbol];
    if (hardFilter(ticker, direction, change24h)) continue;

    const p = parse(ticker);
    if (!p) continue;

    // 刻意不写 `?? 0`：请求失败和"真的是 0"必须能区分开，
    // 前者走 oiRatioScore 的中性分支，后者是一个真实的（很差的）0 分。
    const openInterest = oiMap[ticker.symbol];
    const oiVolumeRatio =
      openInterest === undefined ? undefined : p.quoteVolume > 0 ? openInterest / p.quoteVolume : 0;
    // 资金费率缺失默认 0 是安全的：fundingScore(0) 恰好就是中性 50。
    const fundingRate = frMap[ticker.symbol] ?? 0;
    const marketCapScore = marketCapMap ? getMarketCapScore(entry) : MARKET_CAP_FALLBACK_SCORE;

    scored.push({
      raw: scoreToken(p, direction, oiVolumeRatio, fundingRate, marketCapScore, change24h),
      row: {
        symbol: ticker.symbol,
        lastPrice: p.last,
        priceChangePercent: change24h ?? null,
        highPrice: p.high,
        lowPrice: p.low,
        quoteVolume: p.quoteVolume,
        amplitude: p.amplitude,
        marketCap: entry?.marketCap ?? null,
        marketCapRank: entry?.rank ?? null,
        openInterest: openInterest ?? null,
        fundingRate,
        oiVolumeRatio: oiVolumeRatio ?? null,
      },
    });
  }

  return scored
    .sort((a, b) => b.raw - a.raw)
    .slice(0, GROUP_SIZE)
    .map(({ raw, row }) => ({ ...row, score: Math.round(raw) }));
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
