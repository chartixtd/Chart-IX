/**
 * BingX 在永续合约里混了一批代币化的非加密标的——黄金/白银/原油等大宗商品
 * (NCCO)、外汇 (NCFX)、美股 (NCSK)、股指 (NCSI)，全部以 USDT 计价、走同一套
 * swap 行情/K 线/深度接口。这里提供统一的分类与展示名称格式化，供 UI 侧
 * （交易对列表分类 Tab、展示名）复用。
 *
 * 与 src/lib/screener-scoring.ts 的 isSyntheticProduct 用的是同一个前缀集合
 * （该文件出于独立性考虑保留自己的正则，二者不做强耦合），但语义一致：
 * 四个明确前缀而不是裸 "NC"，避免误伤 NCASH 这类真实币种。
 */

export type InstrumentCategory = "crypto" | "commodities" | "forex" | "stocks" | "indices";

export const INSTRUMENT_CATEGORIES: InstrumentCategory[] = [
  "crypto",
  "commodities",
  "forex",
  "stocks",
  "indices",
];

const PREFIX_TO_CATEGORY: Record<string, InstrumentCategory> = {
  NCCO: "commodities",
  NCFX: "forex",
  NCSK: "stocks",
  NCSI: "indices",
};

export function classifyInstrument(symbol: string): InstrumentCategory {
  return PREFIX_TO_CATEGORY[symbol.slice(0, 4)] ?? "crypto";
}

export function isNonCryptoInstrument(symbol: string): boolean {
  return classifyInstrument(symbol) !== "crypto";
}

/**
 * 展示名称：优先用合约的 displayName（BingX 原样给的，如 "GOLD(XAU)-USDT"），
 * 去掉尾部计价货币后缀；6 位字母的外汇代码额外插入 "/" 分隔（EURUSD → EUR/USD）。
 *
 * 只对代币化商品/外汇/美股/指数改写——真正的加密永续 BingX 也会给 displayName
 * （如 BTC-USDT 的 displayName 就是 "BTC-USDT"），如果不按分类过滤，会把整个
 * 交易对列表的展示格式都从 "BTC-USDT" 悄悄改成 "BTC"，这是没人要求过的改动，
 * 会让合约列表和现货列表的展示风格不一致。
 */
export function formatInstrumentLabel(symbol: string, displayName?: string): string {
  if (!displayName || classifyInstrument(symbol) === "crypto") return symbol;
  const stripped = displayName.replace(/-USDT$/, "");
  if (classifyInstrument(symbol) === "forex" && /^[A-Z]{6}$/.test(stripped)) {
    return `${stripped.slice(0, 3)}/${stripped.slice(3)}`;
  }
  return stripped;
}
