/**
 * 仓位计算器的全部算法。
 *
 * 刻意做成一个不依赖 React、不碰网络的纯函数：这样「算法与参照计算器一致」
 * 是可以被单元测试证明的，而不是靠肉眼比对界面。页面只负责收集输入与展示。
 *
 * 四类资产不写四份分支——它们的差别全部收敛到 quoteToUsd / baseToUsd 两个
 * 换算率上（见 resolveRates），主链路只有一条。
 */

export type AssetClass = "stocks" | "crypto" | "forex" | "futures";
export type Direction = "long" | "short";
export type RiskMode = "percent" | "amount";
export type StopMode = "price" | "pips";
export type RiskBand = "very-conservative" | "conservative" | "moderate" | "high" | "very-high";

/** 一标准手的基础币单位数。 */
export const LOT_SIZE = 100_000;

/**
 * 只收录含美元的币对。美元账户下，这类币对的两个换算率都能从入场价推出，
 * 不需要任何行情或汇率数据；交叉盘（如 EUR/GBP）需要外部汇率，刻意不做。
 */
export const FOREX_PAIRS = {
  "EUR/USD": { pipSize: 0.0001, usdSide: "quote" },
  "GBP/USD": { pipSize: 0.0001, usdSide: "quote" },
  "AUD/USD": { pipSize: 0.0001, usdSide: "quote" },
  "NZD/USD": { pipSize: 0.0001, usdSide: "quote" },
  "USD/JPY": { pipSize: 0.01, usdSide: "base" },
  "USD/CHF": { pipSize: 0.0001, usdSide: "base" },
  "USD/CAD": { pipSize: 0.0001, usdSide: "base" },
} as const;

export type ForexPairKey = keyof typeof FOREX_PAIRS;

export interface PositionSizeInput {
  assetClass: AssetClass;
  direction: Direction;
  accountBalance: number;
  riskMode: RiskMode;
  riskPercent?: number;
  riskAmount?: number;
  entryPrice: number;
  stopMode: StopMode;
  stopPrice?: number;
  stopPips?: number;
  leverage: number;
  forexPair?: ForexPairKey;
  contractMultiplier?: number;
  takeProfitPrice?: number | null;
  feePercent?: number;
  slippage?: number;
}

export type InvalidReason =
  | "balance-invalid"
  | "entry-invalid"
  | "risk-invalid"
  | "leverage-invalid"
  | "stop-invalid"
  | "stop-distance-zero";

export type PositionSizeResult =
  | { ok: false; reason: InvalidReason }
  | {
      ok: true;
      units: number;
      /** 仅外汇有意义：units / LOT_SIZE。其余资产为 null。 */
      lots: number | null;
      positionValue: number;
      requiredMargin: number;
      riskAmount: number;
      stopDistance: number;
      stopDistancePct: number;
      accountRiskPct: number;
      positionRiskPct: number;
      marginUsedPct: number;
      maxLosses: number;
      riskBand: RiskBand;
      riskRewardRatio: number | null;
      expectedProfit: number | null;
    };

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * 风险档位。阈值是在参照计算器上逐点扫描实测出来的
 * （0.5/1/1.5/2/2.5/3/3.5/4/4.9/5/5.5/8/12），不是估的。
 */
function resolveRiskBand(accountRiskPct: number): RiskBand {
  if (accountRiskPct <= 1) return "very-conservative";
  if (accountRiskPct <= 2) return "conservative";
  if (accountRiskPct <= 3) return "moderate";
  if (accountRiskPct <= 5) return "high";
  return "very-high";
}

/**
 * 把四类资产收敛成两个换算率：
 *  · quoteToUsd —— 价格每变动 1 个单位，每 1 单位标的对应多少美元
 *  · baseToUsd  —— 每 1 单位标的值多少美元（用来算仓位价值）
 */
function resolveRates(input: PositionSizeInput): { quoteToUsd: number; baseToUsd: number } {
  const { assetClass, entryPrice } = input;

  if (assetClass === "futures") {
    const m = isPositive(input.contractMultiplier) ? input.contractMultiplier : 1;
    return { quoteToUsd: m, baseToUsd: entryPrice * m };
  }

  if (assetClass === "forex") {
    const pair = input.forexPair ? FOREX_PAIRS[input.forexPair] : undefined;
    // 基础币是美元（USD/JPY 这类）：价格是「1 美元换多少报价币」，所以报价币
    // 换回美元要除以价格；而 1 单位标的本身就是 1 美元。
    if (pair?.usdSide === "base") {
      return { quoteToUsd: 1 / entryPrice, baseToUsd: 1 };
    }
    // 报价币是美元（EUR/USD 这类）：价格已经是美元计价。
    return { quoteToUsd: 1, baseToUsd: entryPrice };
  }

  // 股票与加密：一手就是一股/一枚，价格就是美元。
  return { quoteToUsd: 1, baseToUsd: entryPrice };
}

/** 止损价：按价格输入就直接用；按点数输入则依方向从入场价推。 */
function resolveStopPrice(input: PositionSizeInput): number | null {
  if (input.stopMode === "price") {
    return typeof input.stopPrice === "number" && Number.isFinite(input.stopPrice)
      ? input.stopPrice
      : null;
  }
  if (!isPositive(input.stopPips)) return null;
  const pipSize = input.forexPair ? FOREX_PAIRS[input.forexPair].pipSize : 0.0001;
  const offset = input.stopPips * pipSize;
  return input.direction === "long" ? input.entryPrice - offset : input.entryPrice + offset;
}

export function computePositionSize(input: PositionSizeInput): PositionSizeResult {
  if (!isPositive(input.accountBalance)) return { ok: false, reason: "balance-invalid" };
  if (!isPositive(input.entryPrice)) return { ok: false, reason: "entry-invalid" };
  if (!isPositive(input.leverage) || input.leverage < 1) {
    return { ok: false, reason: "leverage-invalid" };
  }

  const riskAmount =
    input.riskMode === "percent"
      ? (isPositive(input.riskPercent) ? input.accountBalance * (input.riskPercent / 100) : 0)
      : (isPositive(input.riskAmount) ? input.riskAmount : 0);
  if (!isPositive(riskAmount)) return { ok: false, reason: "risk-invalid" };

  const stopPrice = resolveStopPrice(input);
  if (stopPrice === null || !Number.isFinite(stopPrice)) {
    return { ok: false, reason: "stop-invalid" };
  }

  const stopDistance = Math.abs(input.entryPrice - stopPrice);
  const slippage = isPositive(input.slippage) ? input.slippage : 0;
  if (stopDistance + slippage <= 0) return { ok: false, reason: "stop-distance-zero" };

  const { quoteToUsd, baseToUsd } = resolveRates(input);

  // 手续费按单位摊算，不按仓位价值的百分比——后者会让方程自我引用（仓位价值
  // 依赖数量、数量又依赖含费风险额），解不出来。入场与止损各收一次。
  const feePercent = isPositive(input.feePercent) ? input.feePercent : 0;
  const feePerUnit = (input.entryPrice + stopPrice) * (feePercent / 100) * quoteToUsd;

  const riskPerUnit = (stopDistance + slippage) * quoteToUsd + feePerUnit;
  if (!isPositive(riskPerUnit)) return { ok: false, reason: "stop-distance-zero" };

  const units = riskAmount / riskPerUnit;
  const positionValue = units * baseToUsd;
  const requiredMargin = positionValue / input.leverage;
  const accountRiskPct = (riskAmount / input.accountBalance) * 100;

  const tp = input.takeProfitPrice;
  const hasTp = typeof tp === "number" && Number.isFinite(tp) && tp > 0 && stopDistance > 0;

  return {
    ok: true,
    units,
    lots: input.assetClass === "forex" ? units / LOT_SIZE : null,
    positionValue,
    requiredMargin,
    riskAmount,
    stopDistance,
    stopDistancePct: (stopDistance / input.entryPrice) * 100,
    accountRiskPct,
    positionRiskPct: positionValue > 0 ? (riskAmount / positionValue) * 100 : 0,
    marginUsedPct: (requiredMargin / input.accountBalance) * 100,
    maxLosses: Math.floor(input.accountBalance / riskAmount),
    riskBand: resolveRiskBand(accountRiskPct),
    riskRewardRatio: hasTp ? Math.abs(tp - input.entryPrice) / stopDistance : null,
    expectedProfit: hasTp ? units * Math.abs(tp - input.entryPrice) * quoteToUsd : null,
  };
}
