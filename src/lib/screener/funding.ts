import type { CoinGlassFundingRow } from "@/lib/coinglass/types";

/**
 * 资金费率取用户实际下单那家的，不是市场平均值 —— 这是真金白银要付的数字。
 * 那家没上这个币时回落到中位数（不是均值：某个交易所报一个离谱的费率
 * 会把均值整个带偏，中位数不会）。
 *
 * 整行拿不到返回 null 而不是 0：0 是一个完全真实的费率值，
 * 拿它表示缺失会让前端把「没数据」显示成「费率为零」。
 */
export function pickFundingRate(
  row: CoinGlassFundingRow | undefined,
  preferred: string
): number | null {
  const list = row?.stablecoin_margin_list ?? [];
  const clean = list.filter((e) => Number.isFinite(e.funding_rate));
  if (clean.length === 0) return null;

  const exact = clean.find((e) => e.exchange === preferred);
  if (exact) return exact.funding_rate;

  const sorted = clean.map((e) => e.funding_rate).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
