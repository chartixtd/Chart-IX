import type { BingXTrade } from "@/types/bingx";

/** 少于这个样本数不判定大单——否则首笔成交必然"超过中位数 3 倍"，开盘即满屏高亮。 */
export const MIN_SAMPLE_SIZE = 10;
/** 成交量达到中位数的这个倍数即标记为大单。 */
export const LARGE_TRADE_MULTIPLIER = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 标记异常大额成交：数量 >= 中位数 × LARGE_TRADE_MULTIPLIER。
 *
 * 用中位数而非平均值做基准——平均值会被单笔巨额成交自己抬高，导致真有
 * 连续大单时反而一笔都标不出来；中位数对离群值免疫，正是标记离群值所需。
 */
export function markLargeTrades(
  trades: BingXTrade[]
): Array<BingXTrade & { isLarge: boolean }> {
  const validQtys = trades
    .map((t) => parseFloat(t.qty))
    .filter((q) => Number.isFinite(q) && q > 0);

  if (validQtys.length < MIN_SAMPLE_SIZE) {
    return trades.map((t) => ({ ...t, isLarge: false }));
  }

  const threshold = median(validQtys) * LARGE_TRADE_MULTIPLIER;

  return trades.map((t) => {
    const qty = parseFloat(t.qty);
    const isLarge = Number.isFinite(qty) && qty > 0 && qty >= threshold;
    return { ...t, isLarge };
  });
}
