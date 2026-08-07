"use client";

import { useQuery } from "@tanstack/react-query";
import type { FuturesOrder, FuturesFillRecord } from "@/lib/bingx/futures";

/**
 * 交易关键数据（余额/杠杆/持仓/挂单）严禁在 queryKey 切换时展示旧值。
 * OrderForm 的 confirmedLeverage 门控依赖"新 keyData 未到达时为 undefined"这一语义——
 * 当 direction 进入 queryKey 时，方向切换会触发新查询，此刻旧方向的数据必须为 undefined，
 * 不得用 keepPreviousData 作为 placeholder，否则旧杠杆会被误标为新方向"已确认"。
 * 同理 useSymbolSpec 的规格数据参与下单校验，不得用旧 symbol 的精度/步长/最小名义值。
 * 因此这个文件的所有 useQuery 显式指定 placeholderData: undefined 来覆盖全局 keepPreviousData。
 */

export type { FuturesOrder, FuturesFillRecord };

interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

interface FuturesAccount {
  availableMargin: number;
  equity: number;
  leverage: number;
  maxLeverage: number;
  marginType: string;
  dualSidePosition: boolean;
}

export interface FuturesPosition {
  symbol: string;
  positionId: string;
  positionSide: "LONG" | "SHORT";
  positionAmt: string;
  unrealizedProfit: string;
  leverage: number;
  avgPrice: string;
  markPrice: string;
  liquidationPrice: string;
  isolated: boolean;
  /** 实际占用的保证金，来自 BingX 的 initialMargin 字段 */
  initialMargin: string;
}

export interface FuturesOpenOrder {
  symbol: string;
  orderId: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  stopPrice?: string;
  executedQty: string;
  status: string;
  leverage: number;
}

export interface SpotOpenOrder {
  symbol: string;
  orderId: string;
  price: string;
  stopPrice?: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
  time: number;
  updateTime: number;
}

export interface SpotTradeRecord {
  symbol: string;
  id: string;
  orderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

/** Spot available balance. When enabled=false (not logged in/no API key bound), no request is made */
export function useSpotBalances(enabled = true) {
  return useQuery({
    queryKey: ["trading", "spot-balances"],
    queryFn: async () => {
      const data = await getJson<{ balances: SpotBalance[] }>("/api/bingx/account/balance");
      return data.balances ?? [];
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/**
 * Single trading pair + direction contract account state: available margin + current/max leverage + margin mode + position mode.
 *
 * `direction` participates in queryKey: BingX's confirmed leverage is stored by symbol+positionSide (see
 * setLeverage's positionSide parameter). Long and short sides may have different confirmed leverage values.
 * Without direction in queryKey, switching directions won't re-fetch and will use the other side's leverage
 * as the current direction's confirmed value, which is the root cause of the "leverage not re-confirmed after
 * direction reversal" bug discovered in review.
 */
export function useFuturesAccount(symbol: string, direction: "LONG" | "SHORT" = "LONG", enabled = true) {
  return useQuery<FuturesAccount>({
    queryKey: ["trading", "futures-account", symbol, direction],
    queryFn: async () => {
      const [balance, leverage, mode] = await Promise.all([
        getJson<{ availableMargin: string; equity: string } | null>(
          "/api/bingx/futures/positions?type=balance"
        ),
        // route now selects long/short's corresponding leverage field by side parameter
        // (BingX's query interface returns long and short separately)
        getJson<{ leverage: number; maxLeverage: number; marginType: string }>(
          `/api/bingx/futures/positions?type=leverage&symbol=${encodeURIComponent(symbol)}&side=${direction}`
        ),
        getJson<{ dualSidePosition: boolean }>("/api/bingx/futures/positions?type=accountMode"),
      ]);
      return {
        availableMargin: parseFloat(balance?.availableMargin ?? "0") || 0,
        equity: parseFloat(balance?.equity ?? "0") || 0,
        leverage: leverage.leverage,
        maxLeverage: leverage.maxLeverage,
        marginType: leverage.marginType,
        dualSidePosition: mode.dualSidePosition,
      };
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled: enabled && !!symbol,
    retry: false,
    placeholderData: undefined,
  });
}

/** All positions under account (not filtered by symbol — panel itself is an "all positions under account" view) */
export function useFuturesPositions(enabled = true) {
  return useQuery<FuturesPosition[]>({
    queryKey: ["trading", "futures-positions"],
    queryFn: () => getJson<FuturesPosition[]>("/api/bingx/futures/positions"),
    // WS user data stream (useUserDataStream) will invalidate immediately when
    // ORDER_TRADE_UPDATE/ACCOUNT_UPDATE arrives, triggering a re-fetch. This 30s polling
    // is just a fallback for connection loss, not the primary update mechanism
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/** All open orders under account (not filtered by symbol) */
export function useFuturesOpenOrders(enabled = true) {
  return useQuery<FuturesOpenOrder[]>({
    queryKey: ["trading", "futures-open-orders"],
    queryFn: async () => {
      const raw = await getJson<FuturesOpenOrder[] | { orders: FuturesOpenOrder[] }>("/api/bingx/futures/open-orders");
      return Array.isArray(raw) ? raw : raw?.orders ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

interface FuturesContractSpec {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
}

/**
 * 交易对的真实价格/数量小数位，按 symbol 查表用。之前持仓、订单列表全部
 * 硬编码 toFixed(4)，低价格品种（比如 <0.01U 的币）小数位不够，价格会被
 * 截断成一串没有意义的 0；高价格/大数量品种又会多余展示无意义的尾零。
 * 合约规格半小时内基本不变，用较长的 staleTime 避免每次切换 tab 都重新拉。
 */
export function useFuturesContracts(enabled = true) {
  return useQuery<Map<string, FuturesContractSpec>>({
    queryKey: ["trading", "futures-contracts"],
    queryFn: async () => {
      const rows = await getJson<FuturesContractSpec[]>("/api/bingx/market/symbols?market=futures");
      return new Map(rows.map((r) => [r.symbol, r]));
    },
    staleTime: 30 * 60_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/** Futures wallet equity / available margin (account-level, unrelated to current chart symbol) */
export function useFuturesBalance(enabled = true) {
  return useQuery<{ availableMargin: string; equity: string } | null>({
    queryKey: ["trading", "futures-balance"],
    queryFn: () => getJson<{ availableMargin: string; equity: string } | null>("/api/bingx/futures/positions?type=balance"),
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/** All open spot orders under account (not filtered by symbol) */
export function useSpotOpenOrders(enabled = true) {
  return useQuery<SpotOpenOrder[]>({
    queryKey: ["trading", "spot-open-orders"],
    queryFn: async () => {
      const raw = await getJson<SpotOpenOrder[] | { orders: SpotOpenOrder[] }>("/api/bingx/trade/open-orders");
      return Array.isArray(raw) ? raw : raw?.orders ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/** Recent trades under account (not filtered by symbol) */
export function useSpotMyTrades(limit = 30, enabled = true) {
  return useQuery<SpotTradeRecord[]>({
    queryKey: ["trading", "spot-my-trades", limit],
    queryFn: async () => {
      const raw = await getJson<SpotTradeRecord[] | { fills: SpotTradeRecord[] }>(`/api/bingx/trade/my-trades?limit=${limit}`);
      return Array.isArray(raw) ? raw : raw?.fills ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/** 历史订单（不限 symbol，账户全部合约历史） */
export function useFuturesOrderHistory(enabled = true) {
  return useQuery<FuturesOrder[]>({
    queryKey: ["trading", "futures-order-history"],
    queryFn: async () => {
      const raw = await getJson<FuturesOrder[] | { orders: FuturesOrder[] }>("/api/bingx/futures/history-orders");
      return Array.isArray(raw) ? raw : raw?.orders ?? [];
    },
    staleTime: 30_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}

/** 成交记录（不限 symbol，账户全部合约成交） */
export function useFuturesFillHistory(enabled = true) {
  return useQuery<FuturesFillRecord[]>({
    queryKey: ["trading", "futures-fill-history"],
    queryFn: async () => {
      const raw = await getJson<FuturesFillRecord[] | { fills: FuturesFillRecord[] }>("/api/bingx/futures/fill-history");
      return Array.isArray(raw) ? raw : raw?.fills ?? [];
    },
    staleTime: 30_000,
    enabled,
    retry: false,
    placeholderData: undefined,
  });
}
