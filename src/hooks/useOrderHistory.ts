"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fromLiveOrder,
  fromPaperOrder,
  fromPaperLimitOrder,
  type OrderRow,
  type PaperLimitOrderLike,
} from "@/lib/orders/row";
import type { Order, PaperOrder } from "@/types";

/** 每次取多少条。页面可以按这个步长继续往回翻。 */
export const ORDER_PAGE_SIZE = 200;

interface PaperAccountRow {
  id: string;
}

/**
 * /orders 页面的历史数据。
 *
 * 实盘单、模拟盘成交、模拟盘挂单合到一个列表里按时间倒序——页面副标题
 * 承诺的就是「实盘与模拟交易的委托、成交与历史记录」，而此前这里只查了
 * 实盘那一张表。
 *
 * 三张表各取 limit 条再合并，所以合并后最多 3×limit 条；这不影响
 * 「最近的在最前」这个唯一重要的性质。
 */
export function useOrderHistory(userId: string | null, limit: number = ORDER_PAGE_SIZE) {
  return useQuery({
    queryKey: ["orders", "history", userId, limit],
    queryFn: async (): Promise<OrderRow[]> => {
      const supabase = createClient();

      const live = supabase
        .from("orders")
        .select("*")
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false })
        .limit(limit);

      // 模拟盘的行是按 account_id 组织的，先拿账户。这里读 paper_accounts
      // 而不是调 get_or_create_paper_account：历史页只是看，不该顺手给
      // 从没用过模拟盘的用户开一个账户。
      const account = supabase
        .from("paper_accounts")
        .select("id")
        .eq("user_id", userId as string)
        .maybeSingle<PaperAccountRow>();

      const [liveRes, accountRes] = await Promise.all([live, account]);
      if (liveRes.error) throw new Error(liveRes.error.message);

      const rows: OrderRow[] = (((liveRes.data as unknown as Order[]) ?? []).map(fromLiveOrder));

      const accountId = accountRes.data?.id;
      if (accountId) {
        const [fills, limits] = await Promise.all([
          supabase
            .from("paper_orders")
            .select("*")
            .eq("account_id", accountId)
            .order("created_at", { ascending: false })
            .limit(limit),
          supabase
            .from("paper_limit_orders")
            .select("*")
            .eq("account_id", accountId)
            .order("created_at", { ascending: false })
            .limit(limit),
        ]);

        for (const o of ((fills.data as unknown as PaperOrder[]) ?? [])) {
          rows.push(fromPaperOrder(o));
        }
        // 已成交的挂单同时也会留下一条 paper_orders 流水，两边都收会让
        // 同一笔在列表里出现两次。挂单表只取还没成交的那些。
        for (const o of ((limits.data as unknown as PaperLimitOrderLike[]) ?? [])) {
          if (o.status === "filled") continue;
          rows.push(fromPaperLimitOrder(o));
        }
      }

      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return rows;
    },
    enabled: !!userId,
    staleTime: 15_000,
    gcTime: 30 * 60_000,
    // Key is split by userId — never show one user's order history as a
    // placeholder for another (account switch / cross-tab session sync).
    placeholderData: undefined,
  });
}

/**
 * 进页面时跟 BingX 对一次账，把未终结的实盘单的成交状态、成交均价与
 * 手续费回写进来，然后刷新历史查询。
 *
 * 只在挂载时打一次。真正的节流在服务端（reconcile.ts 的冷却窗口），
 * 这里的 ref 只是防 React 严格模式的双次挂载。
 */
export function useOrderSync(userId: string | null) {
  const queryClient = useQueryClient();
  const fired = useRef(false);
  const [syncing, setSyncing] = useState(false);

  const sync = useCallback(
    async (opts?: { always?: boolean }) => {
      if (!userId) return;
      setSyncing(true);
      try {
        const res = await fetch("/api/orders/sync", { method: "POST" });
        const json = await res.json();
        // 手动刷新时无论对账结果如何都重新取数：用户按下刷新，
        // 期待的是「现在去看一眼」，不是「只有变了才给我看」。
        if (opts?.always || (json?.success && json.data?.updated > 0)) {
          await queryClient.invalidateQueries({ queryKey: ["orders", "history"] });
        }
      } catch {
        // 对账失败不该影响页面——历史本来就已经渲染出来了
      } finally {
        setSyncing(false);
      }
    },
    [userId, queryClient]
  );

  useEffect(() => {
    if (!userId || fired.current) return;
    fired.current = true;
    void sync();
  }, [userId, sync]);

  return { syncing, sync };
}
