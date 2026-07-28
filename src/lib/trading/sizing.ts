import type { SymbolSpec, OrderSizing, SizeValidation } from "@/types/trading";

/**
 * 向下截断到指定小数位。
 * 先用 toFixed 把数字规整到比目标多几位的十进制表示，再做截断，
 * 以消除 IEEE754 误差——否则 0.29 * 100 = 28.999999999999996 会被截成 0.28。
 */
export function floorToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0;
  const p = Math.max(0, Math.floor(precision));
  const valueAtP = Number(value.toFixed(p));

  const normalized = Number(value.toFixed(Math.min(p + 4, 100)));
  const factor = Math.pow(10, p);
  const floored = Math.floor(normalized * factor) / factor;

  // If the input value is already at p decimal places (within floating-point tolerance),
  // return it as-is to avoid IEEE754 rounding errors
  if (Math.abs(value - valueAtP) < 1e-14) {
    return valueAtP;
  }
  return floored;
}

/** 把 USDT 名义额按参考价换算成对齐精度的币数量 */
export function quoteToBase(
  quoteUsdt: number,
  price: number,
  spec: SymbolSpec
): OrderSizing {
  if (!Number.isFinite(quoteUsdt) || quoteUsdt <= 0 || !Number.isFinite(price) || price <= 0) {
    return { qty: 0, notional: 0, price: price > 0 ? price : 0 };
  }
  const qty = floorToPrecision(quoteUsdt / price, spec.quantityPrecision);
  return { qty, notional: qty * price, price };
}

export function validateOrderSize(sizing: OrderSizing, spec: SymbolSpec): SizeValidation {
  if (!spec.tradable) return { ok: false, reason: "NOT_TRADABLE" };
  if (!Number.isFinite(sizing.qty) || !Number.isFinite(sizing.notional)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }
  if (sizing.qty <= 0) return { ok: false, reason: "ZERO_AFTER_ROUNDING" };
  if (sizing.notional < spec.minNotional) {
    return { ok: false, reason: "BELOW_MIN_NOTIONAL", limit: spec.minNotional };
  }
  if (sizing.qty < spec.minQty) {
    return { ok: false, reason: "BELOW_MIN_QTY", limit: spec.minQty };
  }
  return { ok: true };
}

/** 所需保证金 = 名义额 ÷ 杠杆。杠杆 < 1 视为 1（现货即为 1x） */
export function requiredMargin(notional: number, leverage: number): number {
  const lev = Number.isFinite(leverage) && leverage >= 1 ? leverage : 1;
  return notional / lev;
}

/** 数量转定长字符串。BingX 不接受指数记数法 */
export function formatQty(qty: number, spec: SymbolSpec): string {
  return qty.toFixed(Math.max(0, spec.quantityPrecision));
}

export function roundPrice(price: number, spec: SymbolSpec): string {
  return price.toFixed(Math.max(0, spec.pricePrecision));
}
