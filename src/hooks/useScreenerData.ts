"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFuturesTickers, useSpotTickers } from "@/hooks/useMarketData";
import { useMarketCap } from "@/hooks/useMarketCap";
import {
  selectCandidateSymbols,
  computeScreenerGroups,
  buildChange24hMap,
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

/** 明细请求的并发上限。候选池实测 200-400 个币，无上限地一次性铺开会把上游打爆。 */
const DETAIL_CONCURRENCY = 8;

interface DetailMap {
  map: Record<string, number>;
  /** 拿到有效值的比例；0 表示这一维度全军覆没，上层据此报错而不是渲染一张假装正常的表 */
  okRatio: number;
}

async function fetchDetailMap<T>(
  symbols: string[],
  endpoint: string,
  pick: (value: T) => number
): Promise<DetailMap> {
  const map: Record<string, number> = {};
  let ok = 0;

  for (let i = 0; i < symbols.length; i += DETAIL_CONCURRENCY) {
    const batch = symbols.slice(i, i + DETAIL_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((symbol) => fetchApi<T>(endpoint, { symbol }))
    );
    settled.forEach((result, j) => {
      if (result.status !== "fulfilled") return;
      const value = pick(result.value);
      if (!Number.isFinite(value)) return;
      map[batch[j]] = value;
      ok += 1;
    });
  }

  return { map, okRatio: symbols.length === 0 ? 1 : ok / symbols.length };
}

export interface ScreenerData {
  long: ScreenerResult[];
  short: ScreenerResult[];
  isLoading: boolean;
  isDetailLoading: boolean;
  marketCapUnavailable: boolean;
  error: Error | null;
  /** 任一底层请求正在飞行中；用来禁用"立即刷新"按钮，避免连点成倍放大请求量 */
  isRefreshing: boolean;
  /** 最近一次 ticker 数据落地的时间，ms epoch；0 表示还没成功过 */
  lastUpdated: number;
  refetch: () => void;
}

export function useScreenerData(): ScreenerData {
  const tickersQuery = useFuturesTickers();
  const marketCapQuery = useMarketCap();
  const spotTickersQuery = useSpotTickers();

  // 合约 ticker 的 priceChangePercent 只是 ~3 分钟窗口，动量维度和追高淡汰都需要
  // 现货 ticker 的真 24h 涨跌。现货请求失败或还没回来时退化成空 map——不阻塞页面，
  // 也不并入下面的 error/isLoading，所有币走中性动量分、不做追高淡汰。
  const change24hMap = useMemo(() => {
    if (!tickersQuery.data || !spotTickersQuery.data) return {};
    return buildChange24hMap(tickersQuery.data, spotTickersQuery.data);
  }, [tickersQuery.data, spotTickersQuery.data]);

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

  // 现货落地前不要算候选池：那时 change24hMap 还是空的，追高过滤没生效，算出来的池子
  // 跟现货到达后的池子不一样，会让下面两个明细查询的 key 变一次、全池再打一遍。
  // 现货请求失败时 isPending 转 false、data 仍是 undefined，此时按空 change24hMap 正常降级。
  //
  // 排序后再进 key：BingX 返回数组的顺序抖动会让内容相同的池子被 React Query 当成新 key，
  // 而现货是 30 秒轮询，每次都重算一遍候选池——不排序就会周期性触发全池重打。
  const candidateSymbols = useMemo(() => {
    if (!tickersQuery.data || !marketCapReady || spotTickersQuery.isPending) return [];
    return selectCandidateSymbols(tickersQuery.data, marketCapMap, change24hMap).sort();
  }, [
    tickersQuery.data,
    marketCapMap,
    marketCapReady,
    change24hMap,
    spotTickersQuery.isPending,
  ]);

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
      oiQuery.data?.map ?? {},
      frQuery.data?.map ?? {},
      marketCapMap,
      change24hMap
    );
  }, [tickersQuery.data, marketCapMap, marketCapReady, oiQuery.data, frQuery.data, change24hMap]);

  const isDetailLoading = candidateSymbols.length > 0 && (oiQuery.isPending || frQuery.isPending);

  // fetchDetailMap 内部用 allSettled，所以这两个查询永远不会 reject——okRatio 是唯一
  // 能看出"这一维度 100% 失败"的信号。全军覆没时必须走错误态 + 重试按钮，
  // 而不是渲染一张所有币 OI 都缺失、看起来完全正常的表。
  const detailError = useMemo(() => {
    if (candidateSymbols.length === 0) return null;
    if (oiQuery.data && oiQuery.data.okRatio === 0) {
      return new Error("Open interest unavailable for every candidate");
    }
    if (frQuery.data && frQuery.data.okRatio === 0) {
      return new Error("Funding rate unavailable for every candidate");
    }
    return null;
  }, [candidateSymbols.length, oiQuery.data, frQuery.data]);

  return {
    long: groups.long,
    short: groups.short,
    isLoading:
      tickersQuery.isPending || spotTickersQuery.isPending || !marketCapReady || isDetailLoading,
    isDetailLoading,
    marketCapUnavailable,
    error: (tickersQuery.error as Error | null) ?? detailError,
    isRefreshing:
      tickersQuery.isFetching ||
      marketCapQuery.isFetching ||
      oiQuery.isFetching ||
      frQuery.isFetching,
    lastUpdated: tickersQuery.dataUpdatedAt,
    refetch: () => {
      tickersQuery.refetch();
      marketCapQuery.refetch();
      oiQuery.refetch();
      frQuery.refetch();
    },
  };
}
