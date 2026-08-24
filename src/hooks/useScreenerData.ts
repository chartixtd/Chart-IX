"use client";

import { useQuery } from "@tanstack/react-query";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import type { ScannerRow, ScannerPayload } from "@/lib/screener/types";
import type { AlertCardData } from "@/lib/screener/cards";

type ScannerResponse = ScannerPayload;

async function fetchScannerPayload(): Promise<ScannerResponse> {
  const res = await fetch("/api/screener");
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

export interface ScannerData {
  rows: ScannerRow[];
  cards: AlertCardData[];
  isLoading: boolean;
  error: Error | null;
  /** 请求正在飞行中；用来禁用"立即刷新"按钮，避免连点重复请求 */
  isRefreshing: boolean;
  /** 服务端计算这份结果的时间，ms epoch；0 表示还没成功过。
   *  用服务端时间而不是客户端的 dataUpdatedAt，这样倒计时对所有用户一致。 */
  lastUpdated: number;
  refetch: () => void;
}

export function useScannerData(): ScannerData {
  const query = useQuery<ScannerResponse>({
    queryKey: ["scanner"],
    queryFn: fetchScannerPayload,
    // 客户端跟着服务端的扫描节奏走。服务端有 TTL + DB 双层缓存兜底，
    // 早到的请求只会读到同一份结果，不会触发重复计算。
    refetchInterval: SCAN_INTERVAL_MS,
    staleTime: SCAN_INTERVAL_MS / 2,
  });

  return {
    rows: query.data?.rows ?? [],
    cards: query.data?.cards ?? [],
    isLoading: query.isPending,
    error: query.error as Error | null,
    isRefreshing: query.isFetching,
    lastUpdated: query.data?.computedAt ?? 0,
    refetch: () => {
      query.refetch();
    },
  };
}
