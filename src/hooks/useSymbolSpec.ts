"use client";

import { useQuery } from "@tanstack/react-query";
import type { SymbolSpec, TradingMarket } from "@/types/trading";

async function fetchSpec(
  symbol: string,
  market: TradingMarket,
  side: "LONG" | "SHORT"
): Promise<SymbolSpec> {
  const url = new URL("/api/trading/spec", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("market", market);
  url.searchParams.set("side", side);
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Failed to load symbol spec");
  return json.data as SymbolSpec;
}

/** 交易对规格几乎不变，缓存 1 小时，不做轮询 */
export function useSymbolSpec(
  symbol: string,
  market: TradingMarket,
  side: "LONG" | "SHORT" = "LONG"
) {
  return useQuery({
    queryKey: ["trading", "spec", market, symbol, side],
    queryFn: () => fetchSpec(symbol, market, side),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: !!symbol,
    retry: 1,
  });
}
