"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMarketStore } from "@/stores/market";
import { useBingXDepth, useBingXTrades } from "@/hooks/useBingXWebSocket";
import { trimDepth } from "@/lib/bingx/depth";
import { MARKET_CAP_REFRESH_MS } from "@/lib/market-cap";
import type { BingXSymbol, BingXTicker, BingXKline, BingXDepth, BingXTrade, BingXOpenInterest, BingXFundingRate, BingXContract } from "@/types/bingx";

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
export function useSpotTickers(enabled = true) {
  return useQuery({
    queryKey: ["bingx", "tickers", "spot"],
    queryFn: () => fetchApi<BingXTicker[]>("ticker"),
    // WebSocket 已实时推送价格，这里只需低频刷新以捕获新上架/下架的交易对
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
  });
}

// 单个行情 — WebSocket 实时数据优先
export function useSpotTicker(symbol: string) {
  const wsTicker = useMarketStore((s) => s.tickers[symbol]);
  const wsConnected = useMarketStore((s) => s.wsConnected);

  // 一旦 WebSocket 开始推这个 symbol，下面 5 秒一次的 REST 结果就会被 wsTicker
  // 完全盖掉——纯粹是白跑的请求（首页 4 个币就是每 5 秒 4 个）。这时把轮询降到
  // 30 秒，只当作 WS 静默掉线时的兜底；WS 一断就自动回到 5 秒的实时节奏。
  const wsLive = wsConnected && wsTicker !== undefined;

  const query = useQuery({
    queryKey: ["bingx", "ticker", "spot", symbol],
    queryFn: () => fetchApi<BingXTicker>("ticker", { symbol }),
    refetchInterval: wsLive ? 30_000 : 5_000,
    staleTime: 2_000,
    enabled: !!symbol,
  });

  return { ...query, data: wsTicker ?? query.data };
}

// 合约行情 —— 永续合约价格与现货存在基差，不能复用 useSpotTicker 的数据。
// WebSocket store（useMarketStore）目前只推送现货 ticker，所以这里没有实时数据源
// 可合并，直接轮询 REST 接口（market=futures），刷新节奏与 useSpotTicker 保持一致。
export function useFuturesTicker(symbol: string) {
  return useQuery({
    queryKey: ["bingx", "ticker", "futures", symbol],
    queryFn: () => fetchApi<BingXTicker>("ticker", { symbol, market: "futures" }),
    refetchInterval: 5_000,
    staleTime: 2_000,
    enabled: !!symbol,
  });
}

// 合约批量行情 —— screener 专用。全市场几百个合约的快照体积不小，
// 且 screener 本身按小时重筛，所以刷新节奏跟 screener 对齐而不是跟现货列表对齐。
export function useFuturesTickers(enabled = true) {
  return useQuery({
    queryKey: ["bingx", "tickers", "futures"],
    queryFn: () => fetchApi<BingXTicker[]>("ticker", { market: "futures" }),
    refetchInterval: MARKET_CAP_REFRESH_MS,
    staleTime: MARKET_CAP_REFRESH_MS / 2,
    enabled,
  });
}

// 合约列表（含代币化商品/外汇/美股/指数的 displayName）—— 上架/下架、
// displayName 变化都很少见，长 staleTime 避免每次打开交易对列表都重新请求。
export function useFuturesContracts(enabled = true) {
  return useQuery({
    queryKey: ["bingx", "contracts", "futures"],
    queryFn: () => fetchApi<BingXContract[]>("symbols", { market: "futures" }),
    staleTime: 5 * 60_000,
    enabled,
  });
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

// 订单簿 —— WS 实时推送优先，断线/无数据时立即回落 REST 轮询
// WS 的 depth20 只能服务 limit ≤ 20；更深的请求继续走 REST。
const WS_DEPTH_LEVELS = 20;

export function useOrderBook(symbol: string, limit = 10, market: "spot" | "futures" = "spot") {
  const canUseWs = !!symbol && limit <= WS_DEPTH_LEVELS;
  useBingXDepth(canUseWs ? symbol : null);

  const wsConnected = useMarketStore((s) => s.wsConnected);
  const wsEntry = useMarketStore((s) => s.depths[symbol]);
  // 盘口是交易关键展示数据：只在"连接正常且确有本交易对快照"时才用 WS，
  // 断线/切币尚无数据时立刻回落 REST 轮询，绝不静默展示陈旧盘口。
  const useWs = canUseWs && wsConnected && !!wsEntry;

  const query = useQuery({
    queryKey: ["bingx", "depth", market, symbol, limit],
    queryFn: () => fetchApi<BingXDepth>("depth", { symbol, limit: String(limit), market }),
    refetchInterval: useWs ? false : 2_000,
    staleTime: 1_000,
    enabled: !!symbol && !useWs,
  });

  const wsBook = useMemo(
    () => (wsEntry ? trimDepth(wsEntry.book, limit) : undefined),
    [wsEntry, limit]
  );

  if (useWs && wsBook) {
    return { data: wsBook, isLoading: false, isPlaceholderData: false };
  }
  return {
    data: query.data,
    isLoading: query.isPending,
    isPlaceholderData: query.isPlaceholderData,
  };
}

// 最新成交 —— WS 实时推送优先，断线/无数据/未启用时回落 REST 轮询。
// enabled 由调用方控制：只有面板可见且用户有权限时才应为 true——成交推送约
// 2 次/秒且每次产生新数组引用，不可见面板保持订阅会造成无谓重渲染。
export function useRecentTrades(symbol: string, enabled: boolean, limit = 20, market: "spot" | "futures" = "spot") {
  useBingXTrades(enabled ? symbol : null);

  const wsConnected = useMarketStore((s) => s.wsConnected);
  const wsTrades = useMarketStore((s) => s.trades[symbol]);
  const useWs = enabled && wsConnected && !!wsTrades && wsTrades.length > 0;

  const query = useQuery({
    queryKey: ["bingx", "trades", market, symbol, limit],
    queryFn: () => fetchApi<BingXTrade[]>("trades", { symbol, limit: String(limit), market }),
    refetchInterval: useWs ? false : 3_000,
    staleTime: 1_000,
    enabled: enabled && !!symbol && !useWs,
  });

  const wsSlice = useMemo(
    () => (wsTrades ? wsTrades.slice(0, limit) : undefined),
    [wsTrades, limit]
  );

  if (useWs && wsSlice) {
    return { data: wsSlice, isLoading: false };
  }
  return { data: query.data, isLoading: query.isPending };
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
