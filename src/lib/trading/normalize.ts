import type { BingXSymbol, BingXContract } from "@/types/bingx";
import type { SymbolSpec } from "@/types/trading";

/**
 * 由最小增量（如 0.000001）推导小数位数。
 * BingX 现货只给增量不给位数，合约反之。
 *
 * 从步进值的十进制字符串表示直接数位，而非对 log10 取整——后者只在步进恰为
 * 十的幂时给出正确答案。例如 step = 0.25 时 Math.log10(0.25) ≈ -0.602，取整
 * 得 -1，会算出 precision = 1，但 0.25 网格上合法的最小增量根本不是 0.1，这
 * 是一个悄悄给出错误答案而非报错的缺陷。
 *
 * 经验数据（2026-07-29）：对 BingX 现货 `GET /openApi/spot/v1/common/symbols`
 * 的全量 2237 个交易对抽样，tickSize（16 个不同值）与 stepSize（9 个不同值）
 * 无一例外都是十的幂。因此当前这只是一个健壮性缺口，而非线上已触发的 bug——
 * 但由于该函数最终会用于对真实下单数量做精度截断，一旦未来出现非十的幂步进
 * （如 0.25、0.05），仅返回一个小数位数并不足以让下单数量真正落在该步进的
 * 网格上（例如 0.25 的网格允许 0.50、0.75，但不允许精度为 2 位小数所暗示的
 * 0.30）。要做到真正的网格对齐，需要在 SymbolSpec 上额外携带原始 step 值并
 * 按步进取整，而不仅是小数位数——这超出了当前任务范围，留给未来读者知晓。
 */
export function precisionFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  if (step >= 1) return 0;

  const str = step.toString();
  // JS 在数值小于 1e-6 时会切换到指数记数法，例如 String(1e-7) === "1e-7"，
  // 朴素的 split(".") 会把它错误地当作没有小数点处理。这里显式解析尾数与指数。
  const exponentialMatch = /^(\d+)(?:\.(\d+))?e-(\d+)$/i.exec(str);
  if (exponentialMatch) {
    const [, , mantissaFraction, exponent] = exponentialMatch;
    return (mantissaFraction?.length ?? 0) + Number(exponent);
  }

  const dotIndex = str.indexOf(".");
  return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
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

/**
 * 合约规格归一化。
 *
 * 注意：`side` 参数只用于选取 maxLongLeverage / maxShortLeverage，而 BingX 的
 * live 公开接口并不返回这两个字段（2026-07-29 实测 0/944），因此当前
 * `maxLeverage` 恒为 undefined。保留参数与字段是为了 BingX 恢复返回时自动生效；
 * 需要真实杠杆上限的调用方必须走需签名的 getLeverage()。
 */
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
