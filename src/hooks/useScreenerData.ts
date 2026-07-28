"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSpotTickers } from "@/hooks/useMarketData";
import { hardFilter, computeScreenerResults } from "@/lib/screener-scoring";
import type { ScreenerResult } from "@/lib/screener-scoring";
import type { BingXOpenInterest, BingXFundingRate } from "@/types/bingx";

async function fetchApi<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`/api/bingx/market/${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

export function useScreenerData(direction: "long" | "short") {
  // 第一轮：批量获取 24h ticker + 前端淘汰
  const tickersQuery = useSpotTickers();

  const candidates = useMemo(() => {
    if (!tickersQuery.data) return [];
    return tickersQuery.data
      .filter((t) => t.symbol.endsWith("-USDT"))
      .filter((t) => !hardFilter(t, direction));
  }, [tickersQuery.data, direction]);

  // 第二轮：对候选池批量请求 OI + Funding Rate
  const candidateSymbols = useMemo(
    () => candidates.map((c) => c.symbol),
    [candidates]
  );

  const oiQuery = useQuery({
    queryKey: ["bingx", "screener", "oi", candidateSymbols],
    queryFn: async () => {
      const map: Record<string, number> = {};
      const results = await Promise.allSettled(
        candidateSymbols.map((sym) =>
          fetchApi<BingXOpenInterest>("openInterest", { symbol: sym })
        )
      );
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          map[candidateSymbols[i]] = parseFloat(r.value.openInterest);
        }
      });
      return map;
    },
    enabled: candidateSymbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const frQuery = useQuery({
    queryKey: ["bingx", "screener", "fr", candidateSymbols],
    queryFn: async () => {
      const map: Record<string, number> = {};
      const results = await Promise.allSettled(
        candidateSymbols.map((sym) =>
          fetchApi<BingXFundingRate>("fundingRate", { symbol: sym })
        )
      );
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          map[candidateSymbols[i]] = parseFloat(r.value.lastFundingRate);
        }
      });
      return map;
    },
    enabled: candidateSymbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // 综合打分排序
  const results = useMemo<ScreenerResult[]>(() => {
    if (!tickersQuery.data) return [];
    // 如果 OI/FR 数据还没回来，用空 map 也算分（只是那两个维度 0 分）
    const oiMap = oiQuery.data ?? {};
    const frMap = frQuery.data ?? {};
    return computeScreenerResults(tickersQuery.data, direction, oiMap, frMap);
  }, [tickersQuery.data, direction, oiQuery.data, frQuery.data]);

  return {
    results,
    isLoading: tickersQuery.isLoading || (candidateSymbols.length > 0 && (oiQuery.isLoading || frQuery.isLoading)),
    isTickersLoading: tickersQuery.isLoading,
    isDetailLoading: oiQuery.isLoading || frQuery.isLoading,
    error: tickersQuery.error || oiQuery.error || frQuery.error,
    refetch: () => {
      tickersQuery.refetch();
      oiQuery.refetch();
      frQuery.refetch();
    },
  };
}
