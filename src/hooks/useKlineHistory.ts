"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** true 时 candles 是切换 symbol/interval 前的旧数据（keepPreviousData） */
  isPlaceholder: boolean;
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
  const lastFailureAtRef = useRef<number | null>(null);
  const FAILURE_COOLDOWN_MS = 5_000;

  // symbol/interval/market 换了 = 换了一条完全不同的序列，累积的历史需要清空，
  // 交给最新一页的查询重新播种。这个重置必须在渲染期间同步完成（而不是放进
  // useEffect）：React Query 的缓存默认保留 5 分钟，如果用户在这期间切回一个
  // 已经缓存过的 symbol/interval，`latestQuery.data` 会在换 key 后的第一次渲染
  // 就同步拿到新序列的数据，但 `olderCandles` 这个 state 还是旧序列的——如果
  // 用 effect 重置，会晚一次渲染，导致这一帧把新旧两个不同 symbol 的K线拼在一
  // 起传给图表（下游 fitContent() 可能就用这份错误拼接的数据来定位可见范围）。
  // 用 ref 比较 key 并在渲染体内直接调用 setState 是 React 文档认可的"渲染期间
  // 调整 state"模式，能保证脏数据永远不会被提交渲染。
  const seriesKey = `${market}:${symbol}:${interval}`;
  const seriesKeyRef = useRef(seriesKey);
  if (seriesKeyRef.current !== seriesKey) {
    seriesKeyRef.current = seriesKey;
    requestIdRef.current++;
    hasMoreRef.current = true;
    isLoadingMoreRef.current = false;
    lastFailureAtRef.current = null;
    // 用函数式/条件调用的方式在渲染期间触发一次重渲染；下面的 ref 守卫保证每次
    // key 变化只会触发一次，不会造成无限循环。
    setOlderCandles([]);
    setHasMore(true);
    setIsLoadingMore(false);
  }

  // `latestQuery` 轮询的是固定大小（PAGE_SIZE 根）的滑动窗口：每收线一根，最早
  // 那根就会被挤出窗口。它此时既不在 `olderCandles`（只在 loadMore 成功时更新）
  // 也不在新一页 `latestQuery.data` 里，若不做处理就会在 candles 里留下空洞。
  // 这里把"上一次已确认（非 placeholder）的 latest 页快照"折叠进 olderCandles，
  // 这样任何滑出窗口的蜡烛在下一次轮询前就已经被保留下来。跨 symbol/interval
  // 切换时用 seriesKey 校验，避免把上一条序列的快照错误地折进新序列。
  const prevLatestSnapshotRef = useRef<{ key: string; data: BingXKline[] } | null>(null);
  useEffect(() => {
    if (!latestQuery.data || latestQuery.isPlaceholderData) return;
    const prev = prevLatestSnapshotRef.current;
    if (prev && prev.key === seriesKey && prev.data !== latestQuery.data) {
      setOlderCandles((old) => mergeOlderKlines(old, prev.data));
    }
    prevLatestSnapshotRef.current = { key: seriesKey, data: latestQuery.data };
  }, [latestQuery.data, latestQuery.isPlaceholderData, seriesKey]);

  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMoreRef.current) return;
    if (
      lastFailureAtRef.current !== null &&
      Date.now() - lastFailureAtRef.current < FAILURE_COOLDOWN_MS
    ) {
      return; // 最近失败过，冷却期内不再发起新请求，避免对故障端点连续轰炸
    }
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
      .catch((error) => {
        if (myRequestId !== requestIdRef.current) return;
        // A failed request does not mean history is exhausted — leave hasMore
        // as-is so the caller can retry via another loadMore() call. Only an
        // actual short/empty page (handled in .then via determineHasMore) means
        // there's truly nothing earlier to fetch. Record the failure so the
        // cooldown guard above can prevent a retry storm while it persists.
        lastFailureAtRef.current = Date.now();
        console.error("[useKlineHistory] loadMore failed:", error);
      })
      .finally(() => {
        if (myRequestId === requestIdRef.current) {
          isLoadingMoreRef.current = false;
          setIsLoadingMore(false);
        }
      });
  }, [olderCandles, latestQuery.data, symbol, interval, market]);

  const candles = useMemo(
    () => (latestQuery.data ? mergeOlderKlines(olderCandles, latestQuery.data) : null),
    [olderCandles, latestQuery.data]
  );

  return {
    candles,
    isLoading: latestQuery.isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    isPlaceholder: latestQuery.isPlaceholderData,
  };
}
