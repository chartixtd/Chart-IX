"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Achievement } from "@/types";

export interface AchievementWithStatus extends Achievement {
  earned: boolean;
  earnedAt: string | null;
}

export function useAchievements(userId: string | null) {
  return useQuery({
    queryKey: ["achievements", userId],
    queryFn: async (): Promise<AchievementWithStatus[]> => {
      const supabase = createClient();
      const [{ data: all }, { data: earned }] = await Promise.all([
        supabase.from("achievements").select("*").order("sort_order", { ascending: true }),
        userId
          ? supabase.from("user_achievements").select("achievement_key, earned_at").eq("user_id", userId)
          : Promise.resolve({ data: [] as { achievement_key: string; earned_at: string }[] }),
      ]);

      const earnedMap = new Map((earned ?? []).map((e) => [e.achievement_key, e.earned_at]));
      return ((all ?? []) as Achievement[]).map((a) => ({
        ...a,
        earned: earnedMap.has(a.key),
        earnedAt: earnedMap.get(a.key) ?? null,
      }));
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}
