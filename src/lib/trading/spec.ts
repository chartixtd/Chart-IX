import { getSpotSymbols, getFuturesContracts } from "@/lib/bingx/market";
import { normalizeSpotSymbol, normalizeFuturesContract } from "./normalize";
import type { BingXSymbol, BingXContract } from "@/types/bingx";
import type { SymbolSpec, TradingMarket } from "@/types/trading";

const TTL_MS = 60 * 60 * 1000;

type Entry<T> = { rows: T[]; expiresAt: number };

let spotCache: Entry<BingXSymbol> | null = null;
let futuresCache: Entry<BingXContract> | null = null;
// 并发合并：同一时刻只允许一个在途请求，避免冷启动时 N 个请求同时打 BingX
let spotInflight: Promise<BingXSymbol[]> | null = null;
let futuresInflight: Promise<BingXContract[]> | null = null;

export function clearSpecCache(): void {
  spotCache = null;
  futuresCache = null;
  spotInflight = null;
  futuresInflight = null;
}

async function loadSpot(): Promise<BingXSymbol[]> {
  if (spotCache && spotCache.expiresAt > Date.now()) return spotCache.rows;
  if (spotInflight) return spotInflight;
  spotInflight = getSpotSymbols()
    .then((rows) => {
      spotCache = { rows, expiresAt: Date.now() + TTL_MS };
      return rows;
    })
    .finally(() => {
      spotInflight = null;
    });
  return spotInflight;
}

async function loadFutures(): Promise<BingXContract[]> {
  if (futuresCache && futuresCache.expiresAt > Date.now()) return futuresCache.rows;
  if (futuresInflight) return futuresInflight;
  futuresInflight = getFuturesContracts()
    .then((rows) => {
      futuresCache = { rows, expiresAt: Date.now() + TTL_MS };
      return rows;
    })
    .finally(() => {
      futuresInflight = null;
    });
  return futuresInflight;
}

/** 查询单个交易对的归一化规格。找不到返回 null；网络失败向上抛出（不缓存失败） */
export async function getSymbolSpec(
  symbol: string,
  market: TradingMarket,
  side: "LONG" | "SHORT" = "LONG"
): Promise<SymbolSpec | null> {
  if (market === "spot") {
    const row = (await loadSpot()).find((r) => r.symbol === symbol);
    return row ? normalizeSpotSymbol(row) : null;
  }
  const row = (await loadFutures()).find((r) => r.symbol === symbol);
  return row ? normalizeFuturesContract(row, side) : null;
}
