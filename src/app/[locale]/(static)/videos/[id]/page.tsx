"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { VideoQuiz } from "@/components/video/VideoQuiz";
import { VideoNotes } from "@/components/video/VideoNotes";
import type { Video, Locale } from "@/types";
import { Icon } from "@/components/ui/Icon";

const supabase = createClient();

export default function VideoDetailPage() {
  const params = useParams();
  const videoId = params.id as string;
  const locale = useLocale() as Locale;
  const t = useTranslations("video.detail");
  const tc = useTranslations("video.card");

  const [previewEnded, setPreviewEnded] = useState(false);
  const auth = useAuth();
  const queryClient = useQueryClient();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewIncrementedRef = useRef(false);

  // Block keyboard shortcuts that can be used to download/save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S → save page
      // Ctrl+U / Cmd+U → view source
      // Ctrl+Shift+I / Cmd+Shift+I / F12 → devtools
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "s" || e.key === "S" || e.key === "u" || e.key === "U")
      ) {
        e.preventDefault();
        return false;
      }
      if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i"))) {
        e.preventDefault();
        return false;
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, []);

  const videoQuery = useQuery({
    queryKey: ["video", videoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("videos")
        .select("*, category:video_categories(id, name, slug)")
        .eq("id", videoId)
        .eq("is_deleted", false)
        .single();
      if (error) throw new Error(error.message);
      return data as Video;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const video = videoQuery.data ?? null;
  const loading = videoQuery.isPending;
  const error = videoQuery.error ? (videoQuery.error as Error).message : null;

  // Reset the once-per-video view-count guard when navigating to a new video.
  useEffect(() => {
    viewIncrementedRef.current = false;
  }, [videoId]);

  // Increment view count once
  useEffect(() => {
    // videoQuery.isPlaceholderData guards against the moment videoId has
    // already switched (e.g. a "next lesson" link) but `video` is still the
    // previous video's kept-around data under global keepPreviousData — we
    // must not stamp the new video's row with the old video's view count.
    if (!video || videoQuery.isPlaceholderData || viewIncrementedRef.current) return;
    viewIncrementedRef.current = true;

    supabase
      .from("videos")
      .update({ view_count: (video.view_count ?? 0) + 1 })
      .eq("id", videoId)
      .then(({ error }) => {
        if (!error) {
          queryClient.setQueryData<Video>(["video", videoId], (prev) =>
            prev ? { ...prev, view_count: (prev.view_count ?? 0) + 1 } : prev
          );
        }
      });
  }, [video, videoId, queryClient, videoQuery.isPlaceholderData]);

  // Progress tracking: every 10s
  useEffect(() => {
    if (!video || !auth.userId) return;

    progressIntervalRef.current = setInterval(() => {
      const el = videoRef.current;
      if (!el) return;

      const currentTime = Math.floor(el.currentTime);
      if (currentTime <= 0) return;

      supabase.from("video_progress").upsert(
        {
          user_id: auth.userId,
          video_id: videoId,
          progress_seconds: currentTime,
        },
        { onConflict: "user_id,video_id" }
      );
    }, 10000);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [video, videoId, auth.userId]);

  // 60s preview check for free users on pro videos
  const isProVideo = video?.tier_required === "pro";
  const isFreeUser = auth.tier === "free";
  const needsPreview = isProVideo && isFreeUser;

  const handleTimeUpdate = useCallback(() => {
    if (!needsPreview || previewEnded) return;
    const el = videoRef.current;
    if (el && el.currentTime >= 60) {
      el.pause();
      setPreviewEnded(true);
    }
  }, [needsPreview, previewEnded]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Skeleton className="aspect-video w-full rounded-lg" />
        <div className="mt-6 space-y-3">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/[0.06] text-gold">
            <Icon name="alert" className="h-6 w-6" />
          </span>
          <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-text-primary">Failed to load video</h2>
          <p className="mt-2 text-text-muted">{error}</p>
          <Link href={`/${locale}/videos`}>
            <Button variant="outline" size="md" className="mt-6">
              ← Back to Videos
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Video not found
  if (!video) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/[0.06] text-gold">
            <Icon name="video" className="h-6 w-6" />
          </span>
          <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-text-primary">Video not found</h2>
          <p className="mt-2 text-text-muted">This video may have been removed or is not available.</p>
          <Link href={`/${locale}/videos`}>
            <Button variant="outline" size="md" className="mt-6">
              ← Back to Videos
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Back link */}
      <Link
        href={`/${locale}/videos`}
        className="mb-4 hidden items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary lg:inline-flex"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t("back_to_videos")}
      </Link>

      {/* Video player */}
      <div
        ref={containerRef}
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-black select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          src={`/api/video/stream/${video.id}`}
          className="h-full w-full pointer-events-auto"
          controls
          controlsList="nodownload"
          disablePictureInPicture
          onTimeUpdate={handleTimeUpdate}
          onContextMenu={(e) => e.preventDefault()}
          preload="metadata"
          crossOrigin="anonymous"
        />

        {/* Preview ended overlay */}
        {previewEnded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="rounded-sm border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold mb-4">
              {t("preview_ends")}
            </div>
            <h3 className="text-xl font-semibold text-white font-display tracking-tight">{t("upgrade_to_watch")}</h3>
            <Link href={`/${locale}/upgrade`} className="mt-6">
              <Button variant="primary" size="lg">
                ⚡ Upgrade to Pro
              </Button>
            </Link>
          </div>
        )}

        {/* Preview notice bar */}
        {needsPreview && !previewEnded && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-white/80">{t("free_preview_notice")}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-gold transition-all duration-1000"
                    style={{ width: `${Math.min(((videoRef.current?.currentTime ?? 0) / 60) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <Link href={`/${locale}/upgrade`}>
                <Button variant="primary" size="sm">
                  Upgrade
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Video info */}
      <div className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-text-primary font-display tracking-tight">
            {video.title[locale] ?? video.title["en-US"] ?? "Untitled"}
          </h1>
          <Badge variant={video.tier_required === "pro" ? "gold" : "gray"} size="md">
            {video.tier_required === "pro" ? tc("pro_badge") : tc("free_badge")}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-text-secondary">
          {video.category && (
            <span className="flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {video.category.name[locale] ?? video.category.slug}
            </span>
          )}
          <span className="flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatDuration(video.duration_seconds)}
          </span>
          <span className="flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {tc("watch_count", { count: video.view_count })}
          </span>
        </div>

        {video.description && (
          // 阅读宽度收窄到 68ch，正文用 15px 行高 1.75，照顾移动端中文长文阅读
          <div className="mx-auto max-w-[68ch] py-6 lg:py-12">
            <h2 className="text-lg font-semibold text-text-primary font-display tracking-tight">{t("description")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.75] text-text-secondary lg:text-base">
              {video.description[locale] ?? video.description["en-US"] ?? ""}
            </p>
          </div>
        )}

        <VideoNotes videoId={video.id} videoRef={videoRef} />

        <VideoQuiz videoId={video.id} />
      </div>
    </div>
  );
}
