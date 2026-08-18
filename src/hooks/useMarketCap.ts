"use client";

import { useQuery } from "@tanstack/react-query";
import { buildMarketCapMap, MARKET_CAP_REFRESH_MS } from "@/lib/market-cap";
import type { CoinGeckoMarketRow, MarketCapMap } from "@/lib/market-cap";

export function useMarketCap() {
  return useQuery<MarketCapMap>({
    queryKey: ["market-cap"],
    queryFn: async () => {
      const res = await fetch("/api/market-cap");
      if (!res.ok) throw new Error(`Market cap request failed: ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Market cap API error");
      return buildMarketCapMap(json.data as CoinGeckoMarketRow[]);
    },
    // 服务端已按 1 小时缓存，客户端跟着同一个节奏就够了
    refetchInterval: MARKET_CAP_REFRESH_MS,
    staleTime: MARKET_CAP_REFRESH_MS,
    retry: 1,
  });
}
