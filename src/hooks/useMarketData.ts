"use client";

import { useQuery } from "@tanstack/react-query";
import { useMarketStore } from "@/stores/market";
import type { BingXSymbol, BingXTicker, BingXKline, BingXDepth, BingXTrade, BingXOpenInterest, BingXFundingRate } from "@/types/bingx";

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

// 24h行情 (批量) — 仅提供列表结构/排序，实时价格由各行自行订阅 WebSocket store
export function useSpotTickers() {
  return useQuery({
    queryKey: ["bingx", "tickers", "spot"],
    queryFn: () => fetchApi<BingXTicker[]>("ticker"),
    // WebSocket 已实时推送价格，这里只需低频刷新以捕获新上架/下架的交易对
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 单个行情 — WebSocket 实时数据优先
export function useSpotTicker(symbol: string) {
  const wsTicker = useMarketStore((s) => s.tickers[symbol]);

  const query = useQuery({
    queryKey: ["bingx", "ticker", "spot", symbol],
    queryFn: () => fetchApi<BingXTicker>("ticker", { symbol }),
    refetchInterval: 5_000,
    staleTime: 2_000,
    enabled: !!symbol,
  });

  return { ...query, data: wsTicker ?? query.data };
}

// K线
export function useKlines(symbol: string, interval = "1h", market = "spot") {
  return useQuery({
    queryKey: ["bingx", "klines", market, symbol, interval],
    queryFn: () => fetchApi<BingXKline[]>("klines", { symbol, interval, market, limit: "200" }),
    refetchInterval: 10_000,
    staleTime: 5_000,
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

// 合约未平仓量
export function useOpenInterest(symbol: string) {
  return useQuery({
    queryKey: ["bingx", "openInterest", symbol],
    queryFn: () => fetchApi<BingXOpenInterest>("openInterest", { symbol }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!symbol,
  });
}

// 合约资金费率
export function useFundingRate(symbol: string) {
  return useQuery({
    queryKey: ["bingx", "fundingRate", symbol],
    queryFn: () => fetchApi<BingXFundingRate>("fundingRate", { symbol }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!symbol,
  });
}
