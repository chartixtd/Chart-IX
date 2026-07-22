"use client";

import { useQuery } from "@tanstack/react-query";
import type { BingXSymbol, BingXTicker, BingXKline, BingXDepth, BingXTrade } from "@/types/bingx";

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

// 现货符号列表
export function useSpotSymbols(symbol?: string) {
  return useQuery({
    queryKey: ["bingx", "symbols", "spot", symbol],
    queryFn: () => fetchApi<BingXSymbol[]>("symbols", { ...(symbol && { symbol }) }),
    staleTime: 60_000,
  });
}

// 24h行情 (批量)
export function useSpotTickers() {
  return useQuery({
    queryKey: ["bingx", "tickers", "spot"],
    queryFn: () => fetchApi<BingXTicker[]>("ticker"),
    refetchInterval: 3_000,
    staleTime: 1_000,
  });
}

// 单个行情
export function useSpotTicker(symbol: string) {
  return useQuery({
    queryKey: ["bingx", "ticker", "spot", symbol],
    queryFn: () => fetchApi<BingXTicker>("ticker", { symbol }),
    refetchInterval: 2_000,
    staleTime: 1_000,
    enabled: !!symbol,
  });
}

// K线
export function useKlines(symbol: string, interval = "1h", market = "spot") {
  return useQuery({
    queryKey: ["bingx", "klines", market, symbol, interval],
    queryFn: () => fetchApi<BingXKline[]>("klines", { symbol, interval, market, limit: "200" }),
    staleTime: 60_000,
    enabled: !!symbol,
  });
}

// 订单簿
export function useOrderBook(symbol: string, limit = 10) {
  return useQuery({
    queryKey: ["bingx", "depth", symbol, limit],
    queryFn: () => fetchApi<BingXDepth>("depth", { symbol, limit: String(limit) }),
    refetchInterval: 2_000,
    staleTime: 1_000,
    enabled: !!symbol,
  });
}

// 最新成交
export function useRecentTrades(symbol: string, limit = 20) {
  return useQuery({
    queryKey: ["bingx", "trades", symbol, limit],
    queryFn: () => fetchApi<BingXTrade[]>("trades", { symbol, limit: String(limit) }),
    refetchInterval: 3_000,
    staleTime: 1_000,
    enabled: !!symbol,
  });
}
