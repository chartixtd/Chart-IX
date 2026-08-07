"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Order } from "@/types";

/** Full order history for the /orders page. Capped at 200 — the page is a
 * recent-history view, not an archive export (spec §2). */
export function useOrderHistory(userId: string | null) {
  return useQuery({
    queryKey: ["orders", "history", userId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data as unknown as Order[]) ?? [];
    },
    enabled: !!userId,
    staleTime: 15_000,
    gcTime: 30 * 60_000,
    // Key is split by userId — never show one user's order history as a
    // placeholder for another (account switch / cross-tab session sync).
    placeholderData: undefined,
  });
}
