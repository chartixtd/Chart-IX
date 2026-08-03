"use client";

import { useQuery } from "@tanstack/react-query";
import { SCREENER_REFRESH_MS } from "@/lib/screener-scoring";
import type { ScreenerResult } from "@/lib/screener-scoring";
import type { ScreenerPayload } from "@/lib/screener-server";

async function fetchScreenerPayload(): Promise<ScreenerPayload> {
  const res = await fetch("/api/screener");
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

export interface ScreenerData {
  long: ScreenerResult[];
  short: ScreenerResult[];
  isLoading: boolean;
  marketCapUnavailable: boolean;
  error: Error | null;
  /** 请求正在飞行中；用来禁用"立即刷新"按钮，避免连点重复请求 */
  isRefreshing: boolean;
  /** 服务端计算这份结果的时间，ms epoch；0 表示还没成功过。用服务端时间而不是客户端
   * 的 dataUpdatedAt，这样倒计时对所有用户都是一致的。 */
  lastUpdated: number;
  refetch: () => void;
}

export function useScreenerData(): ScreenerData {
  const query = useQuery<ScreenerPayload>({
    queryKey: ["screener"],
    queryFn: fetchScreenerPayload,
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });

  return {
    long: query.data?.long ?? [],
    short: query.data?.short ?? [],
    isLoading: query.isPending,
    marketCapUnavailable: query.data?.marketCapUnavailable ?? false,
    error: query.error as Error | null,
    isRefreshing: query.isFetching,
    lastUpdated: query.data?.computedAt ?? 0,
    refetch: () => {
      query.refetch();
    },
  };
}
