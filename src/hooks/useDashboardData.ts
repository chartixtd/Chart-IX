"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Video, Article, Order } from "@/types";

export interface ContinueWatchingItem {
  video_id: string;
  progress_seconds: number;
  completed: boolean;
  video: Pick<Video, "id" | "title" | "duration_seconds" | "thumbnail_url"> | null;
}

// Dashboard's own Supabase reads, previously done in the page component via
// useEffect + setState (no caching, no shared loading/error handling, and a
// fresh fetch on every mount) — moved to useQuery to match every other data
// source already on this page (usePaperAccount, useSpotBalances, etc).

export function useContinueWatching(userId: string | null) {
  return useQuery({
    queryKey: ["dashboard", "continue-watching", userId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("video_progress")
        .select("video_id, progress_seconds, completed, video:videos(id, title, duration_seconds, thumbnail_url)")
        .eq("user_id", userId as string)
        .eq("completed", false)
        .order("updated_at", { ascending: false })
        .limit(3);
      return (data as unknown as ContinueWatchingItem[]) ?? [];
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useLatestVideos(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "latest-videos"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("videos")
        .select("*")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(4);
      return (data as Video[]) ?? [];
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useLatestArticles(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "latest-articles"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("articles")
        .select("*")
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(4);
      return (data as Article[]) ?? [];
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useDashboardOrders(userId: string | null) {
  return useQuery({
    queryKey: ["dashboard", "orders", userId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false });
      return (data as unknown as Order[]) ?? [];
    },
    enabled: !!userId,
    staleTime: 15_000,
  });
}
