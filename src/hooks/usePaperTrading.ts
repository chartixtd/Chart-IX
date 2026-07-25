"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PaperAccount, PaperPosition, PaperOrder } from "@/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

// 模拟盘账户 + 持仓
export function usePaperAccount(enabled = true) {
  return useQuery({
    queryKey: ["paper", "account"],
    queryFn: () => fetchJson<{ account: PaperAccount; positions: PaperPosition[] }>("/api/paper/account"),
    staleTime: 5_000,
    enabled,
  });
}

// 模拟盘成交历史
export function usePaperOrders(symbol?: string, enabled = true) {
  return useQuery({
    queryKey: ["paper", "orders", symbol],
    queryFn: () => fetchJson<PaperOrder[]>(`/api/paper/orders${symbol ? `?symbol=${symbol}` : ""}`),
    staleTime: 5_000,
    enabled,
  });
}

// 下单 (市价或限价)
export function usePlacePaperOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { symbol: string; side: "buy" | "sell"; quoteAmount: number; orderType?: "market" | "limit"; price?: number; leverage?: number }) =>
      fetchJson<PaperOrder>("/api/paper/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paper", "account"] });
      queryClient.invalidateQueries({ queryKey: ["paper", "orders"] });
    },
  });
}

// 精确全平仓位（按持仓量平仓，避免名义值换算残留）
export function useClosePaperPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { symbol: string }) =>
      fetchJson<PaperOrder>("/api/paper/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paper", "account"] });
      queryClient.invalidateQueries({ queryKey: ["paper", "orders"] });
    },
  });
}
