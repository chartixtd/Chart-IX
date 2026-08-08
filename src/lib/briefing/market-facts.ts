import { getSpotTickers } from "@/lib/bingx/market";
import { hasUsableQuote } from "@/lib/instruments";
import type { MarketFact } from "./types";

/**
 * 早报标的集。全部于 2026-08-08 实测存在于现货盘。
 *
 * 黄金取 XAUT（Tether Gold）与 PAXG（Paxos Gold）两个黄金代币，**不取**
 * NCCOGOLD2USD-USDT：后者是合约独有的代币化标的，现货盘没有它，拿不到真
 * 24h 涨跌；且代币化商品周末与假日休市（BingX 休市期间 ticker/K线/深度
 * 一律返回 109415，见 instruments.ts），而早报每天都跑，必然撞上周末。
 * 黄金代币 24/7 交易，两者互为交叉校验（实测 +1.37% / +1.43%）。
 */
export const BRIEFING_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "BTC-USDT", label: "BTC" },
  { symbol: "ETH-USDT", label: "ETH" },
  { symbol: "SOL-USDT", label: "SOL" },
  { symbol: "BNB-USDT", label: "BNB" },
  { symbol: "XRP-USDT", label: "XRP" },
  { symbol: "DOGE-USDT", label: "DOGE" },
  { symbol: "XAUT-USDT", label: "XAUT" },
  { symbol: "PAXG-USDT", label: "PAXG" },
];

interface RawTicker {
  symbol?: unknown;
  lastPrice?: unknown;
  openPrice?: unknown;
  priceChangePercent?: unknown;
}

/**
 * 现货 ticker → 行情事实集。
 *
 * 必须用现货：合约 ticker 的 priceChangePercent 只是 ~3 分钟窗口（同刻实测
 * BTC 合约 0.00% vs 现货 0.92%），拿它当 24h 会让早报每天说谎且不报错。
 * 现货实测 openTime→closeTime 恰为 86400000ms，是真 24 小时。
 *
 * 字段形态：priceChangePercent 是带百分号的字符串（"0.92%"），价格字段实际
 * 返回数字而非类型声明的 string——一律 parseFloat(String(v)) 归一。
 */
export function buildMarketFacts(tickers: unknown[]): MarketFact[] {
  const bySymbol = new Map<string, RawTicker>();
  for (const t of tickers) {
    const raw = t as RawTicker;
    if (typeof raw?.symbol === "string") bySymbol.set(raw.symbol, raw);
  }

  const facts: MarketFact[] = [];
  for (const { symbol, label } of BRIEFING_SYMBOLS) {
    const raw = bySymbol.get(symbol);
    if (!raw) continue;

    const lastPrice = parseFloat(String(raw.lastPrice));
    const openPrice = parseFloat(String(raw.openPrice));
    // 复用既有判据：openPrice 为 0 的坏数据会产生天文数字涨跌幅
    if (!hasUsableQuote({ lastPrice, openPrice: String(openPrice) })) continue;

    const change24hPct = parseFloat(String(raw.priceChangePercent));
    if (!Number.isFinite(change24hPct)) continue;

    facts.push({ symbol, label, lastPrice, change24hPct });
  }
  return facts;
}

export async function fetchMarketFacts(): Promise<MarketFact[]> {
  return buildMarketFacts(await getSpotTickers());
}
