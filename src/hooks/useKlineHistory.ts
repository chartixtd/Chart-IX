"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BingXKline } from "@/types/bingx";
import { mergeOlderKlines, determineHasMore, computeNextEndTime } from "@/lib/chart/kline-history";

const PAGE_SIZE = 300;

interface UseKlineHistoryResult {
  /** null 直到最新一页首次加载完成 */
  candles: BingXKline[] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

async function fetchKlinesPage(
  symbol: string,
  interval: string,
  market: string,
  endTime?: number
): Promise<BingXKline[]> {
  const url = new URL("/api/bingx/market/klines", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("market", market);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (endTime !== undefined) url.searchParams.set("endTime", String(endTime));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data as BingXKline[];
}

function earliestOpenTime(klines: BingXKline[]): number | undefined {
  if (!klines.length) return undefined;
  return klines.reduce((min, k) => Math.min(min, k.openTime), klines[0].openTime);
}

/**
 * 给图表加载K线，支持向后翻页：`loadMore()` 拉取更早一页并拼接到已加载数据
 * 前面。最新一页继续用 React Query 轮询保鲜（当前/刚收盘的K线会变）；历史页
 * 只拉一次、不自动重拉（已收盘的K线不会再变）。
 */
export function useKlineHistory(symbol: string, interval: string, market = "spot"): UseKlineHistoryResult {
  const latestQuery = useQuery({
    queryKey: ["bingx", "klines-latest", market, symbol, interval],
    queryFn: () => fetchKlinesPage(symbol, interval, market),
    refetchInterval: 10_000,
    staleTime: 5_000,
    enabled: !!symbol,
  });

  const [olderCandles, setOlderCandles] = useState<BingXKline[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // 同步的重入保护 / 陈旧请求丢弃——state 更新是异步的，不能只靠 state 判断
  const isLoadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const requestIdRef = useRef(0);

  // symbol/interval/market 换了 = 换了一条完全不同的序列，累积的历史清空，
  // 交给最新一页的查询重新播种
  useEffect(() => {
    requestIdRef.current++;
    setOlderCandles([]);
    setHasMore(true);
    hasMoreRef.current = true;
    setIsLoadingMore(false);
    isLoadingMoreRef.current = false;
  }, [symbol, interval, market]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMoreRef.current) return;
    const earliest = earliestOpenTime(olderCandles.length ? olderCandles : latestQuery.data ?? []);
    if (earliest === undefined) return;

    const myRequestId = ++requestIdRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    fetchKlinesPage(symbol, interval, market, computeNextEndTime(earliest))
      .then((page) => {
        if (myRequestId !== requestIdRef.current) return; // 期间 symbol/interval 变了，丢弃
        const more = determineHasMore(page.length, PAGE_SIZE);
        hasMoreRef.current = more;
        setHasMore(more);
        setOlderCandles((prev) => mergeOlderKlines(page, prev));
      })
      .catch(() => {
        if (myRequestId !== requestIdRef.current) return;
        // A failed request does not mean history is exhausted — leave hasMore
        // as-is so the caller can retry via another loadMore() call. Only an
        // actual short/empty page (handled in .then via determineHasMore) means
        // there's truly nothing earlier to fetch.
      })
      .finally(() => {
        if (myRequestId === requestIdRef.current) {
          isLoadingMoreRef.current = false;
          setIsLoadingMore(false);
        }
      });
  }, [olderCandles, latestQuery.data, symbol, interval, market]);

  const candles = latestQuery.data ? mergeOlderKlines(olderCandles, latestQuery.data) : null;

  return { candles, isLoading: latestQuery.isLoading, isLoadingMore, hasMore, loadMore };
}
