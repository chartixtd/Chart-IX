"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface VideoProgressRow {
  video_id: string;
  progress_seconds: number;
  completed: boolean;
  updated_at: string;
}

/**
 * 学习中心要的是这个用户的**整份**观看进度，不是「最近三条」。
 *
 * 一次取完、在客户端派生，而不是分成「总完成数 / 各分类完成数 / 继续观看」
 * 三个查询：那三个数必须来自同一时刻，否则会出现抬头写着 44%、而底下那门课
 * 的进度条对不上的情况。行数上限是这个用户看过的视频数，几百行的量级。
 *
 * RLS 只让人读到自己的行（`auth.uid() = user_id`），所以这里走浏览器端的
 * anon client 就够，不需要服务端代理。
 */
export function useLearnProgress(userId: string | null) {
  return useQuery({
    queryKey: ["learn", "progress", userId],
    queryFn: async (): Promise<VideoProgressRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("video_progress")
        .select("video_id, progress_seconds, completed, updated_at")
        .eq("user_id", userId as string)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data as VideoProgressRow[]) ?? [];
    },
    enabled: !!userId,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    // key 按 userId 切开，且不给占位数据——切换账号时绝不能把上一个人的
    // 进度当成这一个人的先画出来
    placeholderData: undefined,
  });
}
