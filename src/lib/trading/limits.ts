import type { TradingLimits, LimitCheckInput, LimitCheck } from "@/types/trading";

const UNLIMITED: TradingLimits = {
  maxNotionalPerOrder: null,
  maxOrdersPerDay: null,
  maxLeverage: null,
  allowedSymbols: null,
};

/**
 * 用户级配置逐字段覆盖全局默认。
 * 用户侧的 null 表示「未覆盖」而非「不限制」——要给单个用户解除某项限制，
 * 需在该用户行里显式写一个足够大的值。
 */
export function mergeLimits(
  global: TradingLimits | null,
  user: TradingLimits | null
): TradingLimits {
  const g = global ?? UNLIMITED;
  if (!user) return { ...g };
  return {
    maxNotionalPerOrder: user.maxNotionalPerOrder ?? g.maxNotionalPerOrder,
    maxOrdersPerDay: user.maxOrdersPerDay ?? g.maxOrdersPerDay,
    maxLeverage: user.maxLeverage ?? g.maxLeverage,
    allowedSymbols: user.allowedSymbols ?? g.allowedSymbols,
  };
}

export function checkLimits(input: LimitCheckInput, limits: TradingLimits): LimitCheck {
  // 先判交易对：不允许交易时，报「这个币不能交易」比报「金额超限」更有用
  if (limits.allowedSymbols !== null && !limits.allowedSymbols.includes(input.symbol)) {
    return { ok: false, reason: "SYMBOL_NOT_ALLOWED", limit: limits.allowedSymbols.join(", ") };
  }
  if (limits.maxOrdersPerDay !== null && input.ordersToday >= limits.maxOrdersPerDay) {
    return { ok: false, reason: "DAILY_LIMIT_REACHED", limit: limits.maxOrdersPerDay };
  }
  if (limits.maxLeverage !== null && input.leverage > limits.maxLeverage) {
    return { ok: false, reason: "LEVERAGE_TOO_HIGH", limit: limits.maxLeverage };
  }
  if (limits.maxNotionalPerOrder !== null && input.notional > limits.maxNotionalPerOrder) {
    return { ok: false, reason: "NOTIONAL_TOO_LARGE", limit: limits.maxNotionalPerOrder };
  }
  return { ok: true };
}
