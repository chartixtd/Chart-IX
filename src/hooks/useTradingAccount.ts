"use client";

import { useQuery } from "@tanstack/react-query";

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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

/** 现货可用余额。enabled=false 时（未登录/未绑 Key）不发请求 */
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
  });
}

/**
 * 单个交易对 + 方向的合约账户状态：可用保证金 + 当前/最大杠杆 + 保证金模式 + 持仓模式。
 *
 * `direction` 参与 queryKey：BingX 的已确认杠杆是按 symbol+positionSide 存的（见
 * setLeverage 的 positionSide 参数），多空两侧可能持有不同的已确认杠杆。缺少
 * direction 时切换方向不会重新拉取，会把另一侧的杠杆数字当成当前方向的已确认值，
 * 这正是复核发现的“方向翻转后杠杆未重新确认”漏洞的根源之一。
 */
export function useFuturesAccount(symbol: string, direction: "LONG" | "SHORT" = "LONG", enabled = true) {
  return useQuery<FuturesAccount>({
    queryKey: ["trading", "futures-account", symbol, direction],
    queryFn: async () => {
      const [balance, leverage, mode] = await Promise.all([
        getJson<{ availableMargin: string; equity: string } | null>(
          "/api/bingx/futures/positions?type=balance"
        ),
        // route 现在按 side 参数选多空对应的杠杆字段（BingX 的查询接口按多空分开返回）
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
  });
}
