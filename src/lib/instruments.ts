/**
 * BingX 在永续合约里混了一批代币化的非加密标的——黄金/白银/原油等大宗商品
 * (NCCO)、外汇 (NCFX)、美股 (NCSK)、股指 (NCSI)，全部以 USDT 计价、走同一套
 * swap 行情/K 线/深度接口。这里提供统一的分类与展示名称格式化，供 UI 侧
 * （交易对列表分类 Tab、展示名）复用。
 *
 * 与 src/lib/screener/universe.ts 的 isSyntheticProduct 用的是同一个前缀集合
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

/**
 * 合约当前是否在交易时段内。BingX 的 `status`：1=可交易，25=休市。
 *
 * 实测（2026-08-08 周六）：1006 个合约里 801 个 status=1、205 个 status=25，
 * 且与"批量 ticker 接口是否返回该 symbol"**完全一一对应**（801/801、205/205）。
 * 休市的品种在 ticker、K线、深度接口上一律返回 109415 "is pause currently"，
 * 连带时间范围的历史 K 线也取不到——BingX 在休市期间不提供任何数据。
 *
 * 加密永续 24/7 全部 status=1；外汇周末、美股非交易时段整批切到 25，
 * 这正是"外汇品种缺失"的根源：列表若以 ticker 为数据源，一到周末
 * 33/39 个外汇、142/352 个美股就整个从选择器里消失。
 */
export function isContractOpen(status: number): boolean {
  return status === 1;
}

/**
 * 这条行情是否可用于展示涨跌幅。
 *
 * BingX 对一批从未真正成交过的代币化标的返回 `openPrice: "0.00000"`，
 * 于是 `priceChangePercent` 变成把 lastPrice 当成"从 0 涨上来"的天文数字——
 * 实测 USD/RUB 报 +822096901.00%、GBP/NZD 报 +22896901.00%。直接渲染就是
 * 列表里一串荒唐的百分比。
 *
 * 该判据只命中坏数据：对 2026-08-08 全量 801 条行情核对，加密 572 条、
 * 商品 8 条、指数 5 条全部通过，只有 6 条外汇 + 10 条美股（正是 openPrice=0
 * 的那批）被判为不可用，无一误伤。
 */
export function hasUsableQuote(ticker: { lastPrice: string | number; openPrice: string } | undefined): boolean {
  if (!ticker) return false;
  const last = Number(ticker.lastPrice);
  const open = Number(ticker.openPrice);
  return Number.isFinite(last) && last > 0 && Number.isFinite(open) && open > 0;
}
