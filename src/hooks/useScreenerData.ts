"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFuturesTickers } from "@/hooks/useMarketData";
import { useMarketCap } from "@/hooks/useMarketCap";
import {
  selectCandidateSymbols,
  computeScreenerGroups,
  SCREENER_REFRESH_MS,
} from "@/lib/screener-scoring";
import type { ScreenerResult } from "@/lib/screener-scoring";
import type { BingXOpenInterest, BingXFundingRate } from "@/types/bingx";

async function fetchApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`/api/bingx/market/${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

async function fetchDetailMap<T>(
  symbols: string[],
  endpoint: string,
  pick: (value: T) => number
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const settled = await Promise.allSettled(
    symbols.map((symbol) => fetchApi<T>(endpoint, { symbol }))
  );
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      const value = pick(result.value);
      if (Number.isFinite(value)) map[symbols[i]] = value;
    }
  });
  return map;
}

export interface ScreenerData {
  long: ScreenerResult[];
  short: ScreenerResult[];
  isLoading: boolean;
  isDetailLoading: boolean;
  marketCapUnavailable: boolean;
  error: Error | null;
  /** 最近一次 ticker 数据落地的时间，ms epoch；0 表示还没成功过 */
  lastUpdated: number;
  refetch: () => void;
}

export function useScreenerData(): ScreenerData {
  const tickersQuery = useFuturesTickers();
  const marketCapQuery = useMarketCap();

  // 市值请求彻底失败时不阻塞筛选：传 null 让打分退回中性分并跳过排名排除。
  // 空 map（{}）也必须归一成 null——它是真值，会让每个币都走"查不到市值"
  // 那条路拿满分，等于把 BTC 当成微型盘塞进小市值筛选器。
  const marketCapMap = useMemo(() => {
    if (marketCapQuery.isError) return null;
    const data = marketCapQuery.data;
    if (!data || Object.keys(data).length === 0) return null;
    return data;
  }, [marketCapQuery.isError, marketCapQuery.data]);
  const marketCapReady = marketCapQuery.isError || marketCapQuery.data !== undefined;

  // 市值维度退化成中性分的两种情况：请求失败，或拿到的 map 是空的
  const marketCapUnavailable = marketCapReady && marketCapMap === null;

  const candidateSymbols = useMemo(() => {
    if (!tickersQuery.data || !marketCapReady) return [];
    return selectCandidateSymbols(tickersQuery.data, marketCapMap);
  }, [tickersQuery.data, marketCapMap, marketCapReady]);

  const oiQuery = useQuery({
    queryKey: ["bingx", "screener", "oi", candidateSymbols],
    queryFn: () =>
      fetchDetailMap<BingXOpenInterest>(candidateSymbols, "openInterest", (v) =>
        parseFloat(v.openInterest)
      ),
    enabled: candidateSymbols.length > 0,
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });

  const frQuery = useQuery({
    queryKey: ["bingx", "screener", "fr", candidateSymbols],
    queryFn: () =>
      fetchDetailMap<BingXFundingRate>(candidateSymbols, "fundingRate", (v) =>
        parseFloat(v.lastFundingRate)
      ),
    enabled: candidateSymbols.length > 0,
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });

  const groups = useMemo(() => {
    if (!tickersQuery.data || !marketCapReady) return { long: [], short: [] };
    return computeScreenerGroups(
      tickersQuery.data,
      oiQuery.data ?? {},
      frQuery.data ?? {},
      marketCapMap
    );
  }, [tickersQuery.data, marketCapMap, marketCapReady, oiQuery.data, frQuery.data]);

  const isDetailLoading = candidateSymbols.length > 0 && (oiQuery.isPending || frQuery.isPending);

  return {
    long: groups.long,
    short: groups.short,
    isLoading: tickersQuery.isPending || !marketCapReady || isDetailLoading,
    isDetailLoading,
    marketCapUnavailable,
    error: (tickersQuery.error as Error | null) ?? null,
    lastUpdated: tickersQuery.dataUpdatedAt,
    refetch: () => {
      tickersQuery.refetch();
      marketCapQuery.refetch();
      oiQuery.refetch();
      frQuery.refetch();
    },
  };
}
