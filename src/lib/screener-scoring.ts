import type { BingXTicker } from "@/types/bingx";

export interface ScreenerResult {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  amplitude: number;
  openInterest: number;
  fundingRate: number;
  oiVolumeRatio: number;
  score: number;
}

/** 硬性淘汰：触发任一规则返回 true（淘汰） */
export function hardFilter(ticker: BingXTicker, direction: "long" | "short"): boolean {
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const quoteVolume = parseFloat(ticker.quoteVolume);
  const priceChangePercent = parseFloat(ticker.priceChangePercent);

  // 1. 流动性不足：24h 合约成交量 < 1 亿美元
  if (quoteVolume < 100_000_000) return true;

  // 2. 死盘无波动：振幅 < 1.5%
  const amplitude = ((high - low) / low) * 100;
  if (amplitude < 1.5) return true;

  // 3. 拒绝追高
  if (direction === "long" && priceChangePercent > 15) return true;

  // 4. 拒绝追空
  if (direction === "short" && priceChangePercent < -15) return true;

  return false;
}

/** 综合打分 0-100 */
export function scoreToken(
  ticker: BingXTicker,
  openInterest: number,
  fundingRate: number
): number {
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const last = parseFloat(ticker.lastPrice);
  const quoteVolume = parseFloat(ticker.quoteVolume);
  const amplitude = ((high - low) / low) * 100;

  // --- 振幅 (25%) ---
  let ampScore: number;
  if (amplitude >= 2 && amplitude <= 5) {
    ampScore = 100;
  } else if (amplitude >= 1.5 && amplitude < 2) {
    ampScore = ((amplitude - 1.5) / 0.5) * 100;
  } else if (amplitude > 5 && amplitude <= 12) {
    ampScore = 100 - ((amplitude - 5) / 7) * 100;
  } else {
    ampScore = 0;
  }

  // --- 流动性 (25%) ---
  const logVol = Math.log10(quoteVolume);
  // $100M (8) -> 0%, $10B (10) -> 100%
  const liqScore = Math.max(0, Math.min(100, ((logVol - 8) / 2) * 100));

  // --- OI/量比 (20%) ---
  const oiVolRatio = quoteVolume > 0 ? openInterest / quoteVolume : 0;
  let oiScore: number;
  if (oiVolRatio >= 0.3 && oiVolRatio <= 1.5) {
    oiScore = 100;
  } else if (oiVolRatio < 0.3) {
    oiScore = (oiVolRatio / 0.3) * 100;
  } else if (oiVolRatio > 1.5 && oiVolRatio <= 3) {
    oiScore = 100 - ((oiVolRatio - 1.5) / 1.5) * 100;
  } else {
    oiScore = 0;
  }

  // --- 费率健康度 (15%) ---
  const absRate = Math.abs(fundingRate);
  let frScore: number;
  if (absRate < 0.0003) {
    frScore = 100;
  } else if (absRate <= 0.001) {
    frScore = 100 - ((absRate - 0.0003) / 0.0007) * 100;
  } else {
    frScore = 0;
  }

  // --- 趋势位置 (15%) ---
  const position = high > low ? (last - low) / (high - low) : 0.5;
  let trendScore: number;
  // 日内范围中间位置最优（非极端高位/低位）
  if (position >= 0.3 && position <= 0.7) {
    trendScore = 100;
  } else if (position < 0.3) {
    trendScore = (position / 0.3) * 100;
  } else {
    trendScore = 100 - ((position - 0.7) / 0.3) * 100;
  }

  return Math.round(
    ampScore * 0.25 +
    liqScore * 0.25 +
    oiScore * 0.20 +
    frScore * 0.15 +
    trendScore * 0.15
  );
}

/** 批量计算筛选结果并排序 */
export function computeScreenerResults(
  tickers: BingXTicker[],
  direction: "long" | "short",
  oiMap: Record<string, number>,
  frMap: Record<string, number>
): ScreenerResult[] {
  const results: ScreenerResult[] = [];

  for (const ticker of tickers) {
    if (hardFilter(ticker, direction)) continue;

    const high = parseFloat(ticker.highPrice);
    const low = parseFloat(ticker.lowPrice);
    const quoteVolume = parseFloat(ticker.quoteVolume);
    const oi = oiMap[ticker.symbol] ?? 0;
    const fr = frMap[ticker.symbol] ?? 0;

    const score = scoreToken(ticker, oi, fr);

    results.push({
      symbol: ticker.symbol,
      lastPrice: parseFloat(ticker.lastPrice),
      priceChangePercent: parseFloat(ticker.priceChangePercent),
      highPrice: high,
      lowPrice: low,
      quoteVolume,
      amplitude: ((high - low) / low) * 100,
      openInterest: oi,
      fundingRate: fr,
      oiVolumeRatio: quoteVolume > 0 ? oi / quoteVolume : 0,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
