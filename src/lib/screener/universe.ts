import { stripContractMultiplier, TOP_MARKET_CAP_EXCLUDED } from "@/lib/market-cap";
import type { MarketCapMap } from "@/lib/market-cap";
import type { BingXTicker } from "@/types/bingx";

/**
 * 服务端门槛：只负责把池子收到约 150 行，不负责表达用户口味。
 * 真正的筛选在客户端滑块上——服务端对整个池子算一次分，滑块只决定哪些行显示，
 * 所以拉动滑块不会改变任何币的分数，也不会改变警报触发。
 */
export const SERVER_GATE = {
  /** CoinGlass volume_usd 下限。与滑块最小值取等值即可——两边同源，能精确对齐。 */
  minVolumeUsd: 5_000_000,
  minMarketCap: 20_000_000,
  maxMarketCap: 800_000_000,
  /**
   * BingX ticker 的 24h 高低算出的振幅下限，单位 %。
   *
   * 必须严格小于滑块最小值（1%）：粗筛发生在拉 K 线之前，只能用 BingX 的高低，
   * 而客户端滑块用的是 30m K 线算的真振幅。两边不同源却取等值，会误杀一个
   * 真振幅 1.2%、BingX 高低算出 0.95% 的币——而且这种误杀在榜单上完全看不出来。
   */
  minAmplitude: 0.5,
} as const;

/** 客户端滑块的取值域。单位：成交量与市值是百万美元，振幅是 %。 */
export const CLIENT_SLIDER = {
  volume: { min: 5, max: 25, default: 15 },
  amplitude: { min: 1, max: 5, default: 3 },
  marketCapFloor: { min: 30, max: 500, default: 30 },
  /** 市值上限固定，不做成滑块（demo 的读数就是 "30M – 500M"） */
  marketCapCeiling: 500,
} as const;

/**
 * BingX 在永续里混了一批代币化的股票/商品/指数/外汇（NCSK=股票、NCCO=商品、
 * NCSI=指数、NCFX=外汇），它们不是加密货币，不该出现在小市值币筛选器里。
 * 用四个明确前缀而不是裸 "NC"，避免误伤 NCASH 这类真实币种。
 */
export function isSyntheticProduct(symbol: string): boolean {
  return /^NC(SK|CO|SI|FX)/.test(symbol);
}

/**
 * BingX 永续 symbol → CoinGlass 币种名。
 * 两处差异都要抹平：-USDT 后缀，以及 1000PEPE 这种合约乘数前缀
 * （CoinGlass 那边叫 PEPE，对不上就整个币拿不到任何明细数据）。
 */
export function coinFromBingXSymbol(symbol: string): string {
  return stripContractMultiplier(symbol).replace(/-USDT$/, "");
}

export interface PreselectCandidate {
  bingxSymbol: string;
  coin: string;
  marketCap: number;
  marketCapRank: number;
}

/**
 * 批量层的粗筛：只用 BingX ticker + CoinGecko 市值，一次额外的上游调用都不花。
 *
 * 成交额**不在这里筛** —— BingX 长尾的 quoteVolume 是被拍平的假数据
 * （516 个永续里有 144 个全挤在 619–691 万这个 0.73M 宽的带里），
 * 拿它筛成交额等于用假数据决定谁进池子。成交额筛选放到行情层，
 * 用 CoinGlass 的 volume_usd 做，这正是明细层要拆成两段的原因。
 *
 * 查不到市值一律排除：下限是一个「必须证明达标」的条件，
 * 在 CoinGecko 前 1000 名里查不到就无法证明市值 ≥ 2000万，只能当不达标处理。
 */
export function preselect(
  tickers: BingXTicker[],
  marketCapMap: MarketCapMap
): PreselectCandidate[] {
  const seen = new Set<string>();
  const out: PreselectCandidate[] = [];

  for (const t of tickers) {
    if (!t.symbol.endsWith("-USDT")) continue;
    if (isSyntheticProduct(t.symbol)) continue;
    if (seen.has(t.symbol)) continue;

    const entry = marketCapMap[stripContractMultiplier(t.symbol)];
    if (entry === undefined) continue;
    if (entry.rank <= TOP_MARKET_CAP_EXCLUDED) continue;
    if (entry.marketCap < SERVER_GATE.minMarketCap) continue;
    if (entry.marketCap > SERVER_GATE.maxMarketCap) continue;

    const high = parseFloat(t.highPrice);
    const low = parseFloat(t.lowPrice);
    if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) continue;
    if (((high - low) / low) * 100 < SERVER_GATE.minAmplitude) continue;

    seen.add(t.symbol);
    out.push({
      bingxSymbol: t.symbol,
      coin: coinFromBingXSymbol(t.symbol),
      marketCap: entry.marketCap,
      marketCapRank: entry.rank,
    });
  }

  // 排序只是为了让候选池顺序稳定（BingX 返回数组的顺序会抖动），便于比对与排查
  return out.sort((a, b) => a.bingxSymbol.localeCompare(b.bingxSymbol));
}
