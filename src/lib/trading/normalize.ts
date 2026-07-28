import type { BingXSymbol, BingXContract } from "@/types/bingx";
import type { SymbolSpec } from "@/types/trading";

/**
 * 由最小增量（如 0.000001）推导小数位数。
 * BingX 现货只给增量不给位数，合约反之。
 */
export function precisionFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  if (step >= 1) return 0;
  // 用指数记数法避免 0.0000001 被格式化成 "1e-7"
  const exponent = Math.round(Math.log10(step));
  return Math.max(0, -exponent);
}

export function normalizeSpotSymbol(raw: BingXSymbol): SymbolSpec {
  return {
    symbol: raw.symbol,
    market: "spot",
    pricePrecision: precisionFromStep(raw.tickSize),
    quantityPrecision: precisionFromStep(raw.stepSize),
    minQty: raw.minQty,
    minNotional: raw.minNotional,
    tradable: raw.status === 1,
  };
}

export function normalizeFuturesContract(
  raw: BingXContract,
  side: "LONG" | "SHORT"
): SymbolSpec {
  return {
    symbol: raw.symbol,
    market: "futures",
    pricePrecision: raw.pricePrecision,
    quantityPrecision: raw.quantityPrecision,
    minQty: raw.tradeMinQuantity,
    minNotional: raw.tradeMinUSDT,
    maxLeverage: side === "LONG" ? raw.maxLongLeverage : raw.maxShortLeverage,
    takerFeeRate: raw.takerFeeRate,
    tradable: raw.status === 1 && raw.apiStateOpen === "true",
  };
}
