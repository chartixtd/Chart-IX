"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { LearningPath, LearningPathStep, Video, Locale } from "@/types";

interface StepWithVideo extends Omit<LearningPathStep, "video"> {
  video: Pick<Video, "id" | "title" | "duration_seconds" | "tier_required"> | null;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LearningPathDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const locale = useLocale() as Locale;
  const auth = useAuth();

  // path + steps 一次嵌套查询拿全（公开数据，立即发起，不等 auth）
  const pathQuery = useQuery({
    queryKey: ["learn", "path", slug],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("learning_paths")
        .select("*, steps:learning_path_steps(*, video:videos(id, title, duration_seconds, tier_required))")
        .eq("slug", slug)
        .eq("is_published", true)
        .order("sort_order", { referencedTable: "learning_path_steps", ascending: true })
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const { steps, ...path } = data as unknown as LearningPath & { steps: StepWithVideo[] };
      return { path: path as LearningPath, steps: steps ?? [] };
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const steps = pathQuery.data?.steps ?? [];
  const videoIds = steps.map((s) => s.video_id);

  // 用户进度：auth.userId 就绪即发，与 pathQuery 并行（不串行等 path——
  // videoIds 到达前 enabled 为 false，到达后自动触发，仍比原来的三段串行少一跳）
  const progressQuery = useQuery({
    queryKey: ["learn", "progress", auth.userId, slug, videoIds.length],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("video_progress")
        .select("video_id")
        .eq("user_id", auth.userId as string)
        .eq("completed", true)
        .in("video_id", videoIds);
      return new Set((data ?? []).map((p: { video_id: string }) => p.video_id));
    },
    enabled: !!auth.userId && videoIds.length > 0,
    staleTime: 30_000,
    // Key includes auth.userId — never show one user's progress as a
    // placeholder while another user's data is still in flight.
    placeholderData: undefined,
  });
  const completedVideoIds = progressQuery.data ?? new Set<string>();

  useEffect(() => {
    if (
      auth.userId &&
      steps.length > 0 &&
      completedVideoIds.size === steps.length
    ) {
      // Idempotent server-side (no-ops if already earned) — safe to re-fire.
      createClient().rpc("grant_achievement", { p_key: "first_path_completed" }).then(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId, steps.length, completedVideoIds.size]);

  if (pathQuery.isPending) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      </div>
    );
  }

  if (!pathQuery.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState icon={<span className="text-4xl">🧭</span>} title="未找到该学习路径" />
      </div>
    );
  }

  const path = pathQuery.data.path;
  const title = path.title[locale] ?? path.title["en-US"];
  const desc = path.description?.[locale] ?? path.description?.["en-US"];
  const completedCount = steps.filter((s) => completedVideoIds.has(s.video_id)).length;
  const pct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  // A step is unlocked if it's the first one, or every prior step is completed.
  let unlocked = true;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href={`/${locale}/learn`} className="text-sm text-text-secondary hover:text-text-primary">← 学习路径</Link>

      <h1 className="mt-3 text-3xl font-bold text-text-primary">{title}</h1>
      {desc && <p className="mt-2 text-text-secondary">{desc}</p>}

      <div className="mt-6">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>总进度</span>
          <span>{completedCount}/{steps.length} · {pct}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-tertiary">
          <div className="h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-8 space-y-2">
        {steps.map((step, i) => {
          const isCompleted = completedVideoIds.has(step.video_id);
          const isUnlocked = unlocked;
          // Next iteration's lock state depends on this step being completed.
          if (!isCompleted) unlocked = false;

          const videoTitle = step.video?.title[locale] ?? step.video?.title["en-US"] ?? "未知课程";
          const content = (
            <div
              className={cn(
                "flex items-center gap-4 rounded-md border p-4 transition-colors",
                isCompleted ? "border-success/30 bg-success/5"
                  : isUnlocked ? "border-border-default bg-bg-secondary hover:border-gold/50"
                  : "border-border-default bg-bg-secondary/50 opacity-50"
              )}
            >
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                isCompleted ? "bg-success text-black" : isUnlocked ? "gold-gradient text-black" : "bg-bg-tertiary text-text-muted"
              )}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{videoTitle}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {step.video ? formatDuration(step.video.duration_seconds) : ""}
                  {step.video?.tier_required === "pro" && (
                    <Badge variant="gold" className="ml-2">Pro</Badge>
                  )}
                </p>
              </div>
              {!isUnlocked && <span className="shrink-0 text-text-muted">🔒</span>}
            </div>
          );

          return isUnlocked ? (
            <Link key={step.id} href={`/${locale}/videos/${step.video_id}`}>{content}</Link>
          ) : (
            <div key={step.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
