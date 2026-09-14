"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Video, Article, Order, Locale } from "@/types";

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
    gcTime: 30 * 60_000,
    // Key is split by userId — never show one user's continue-watching list
    // as a placeholder for another (account switch / cross-tab session sync).
    placeholderData: undefined,
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
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
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
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
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
        .order("created_at", { ascending: false })
        .limit(50);
      return (data as unknown as Order[]) ?? [];
    },
    enabled: !!userId,
    staleTime: 15_000,
    gcTime: 30 * 60_000,
    // Key is split by userId — never show one user's orders as a placeholder
    // for another (account switch / cross-tab session sync).
    placeholderData: undefined,
  });
}

export interface BriefingItem {
  slug: string;
  title: Record<Locale, string>;
  /** 早报覆盖的那一天，YYYY-MM-DD。从 slug 解出来，见下 */
  day: string;
}

/**
 * 最近几期每日早报。
 *
 * 早报不是单独的表，就是 `articles` 里 slug 形如 `daily-briefing-YYYY-MM-DD`
 * 的行（见 lib/briefing/run.ts）。**日期取自 slug 而不是 published_at**：
 * published_at 是「这一期是什么时候生成的」，流水线重跑或把兜底稿升级成正式稿
 * 时它会变，而 slug 里的那一天是这期早报**覆盖的那一天**，不会变。
 * 后台的 BriefingRunner 用的也是这个解法。
 *
 * 一行里装着三种语言，不按 locale 过滤——取出来用 title[locale] 挑。
 */
export function useDailyBriefings(limit = 3) {
  return useQuery({
    queryKey: ["dashboard", "briefings", limit],
    queryFn: async (): Promise<BriefingItem[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("articles")
        .select("slug, title")
        .like("slug", "daily-briefing-%")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(limit);
      return ((data as { slug: string; title: Record<Locale, string> }[]) ?? []).map((row) => ({
        ...row,
        day: row.slug.replace("daily-briefing-", ""),
      }));
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
