"use client";

import { useQuery } from "@tanstack/react-query";
import { LIVE_PRICE_REFRESH_MS, type LivePricePayload } from "@/lib/screener/live-prices";

async function fetchLivePrices(): Promise<LivePricePayload> {
  const res = await fetch("/api/screener/prices");
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

/**
 * 警报卡的实时价格。与 useScannerData 完全独立：那份数据跟着 15 分钟的
 * 扫描节奏走（受 CoinGlass 配额限制），这份跟着 BingX 的公开行情走。
 *
 * 请求失败时不清空——react-query 会保留上一次成功的 data，卡片继续显示
 * 稍旧的实时价，好过整片回落到十几分钟前的扫描价。
 */
export function useLivePrices(): { prices: Record<string, number>; at: number } {
  const query = useQuery<LivePricePayload>({
    queryKey: ["screener-live-prices"],
    queryFn: fetchLivePrices,
    refetchInterval: LIVE_PRICE_REFRESH_MS,
    staleTime: LIVE_PRICE_REFRESH_MS / 2,
  });

  return { prices: query.data?.prices ?? {}, at: query.data?.at ?? 0 };
}
