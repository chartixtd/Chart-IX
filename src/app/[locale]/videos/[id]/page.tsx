"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Video, Locale } from "@/types";

const supabase = createClient();

export default function VideoDetailPage() {
  const params = useParams();
  const videoId = params.id as string;
  const locale = useLocale() as Locale;
  const t = useTranslations("video.detail");
  const tc = useTranslations("video.card");

  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userTier, setUserTier] = useState<"free" | "pro" | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [previewEnded, setPreviewEnded] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewIncrementedRef = useRef(false);

  // Fetch video and user data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [videoRes, userRes] = await Promise.all([
          supabase
            .from("videos")
            .select("*, category:video_categories(id, name, slug)")
            .eq("id", videoId)
            .eq("is_deleted", false)
            .single(),
          supabase.auth.getUser(),
        ]);

        if (videoRes.error) {
          setError(videoRes.error.message);
          setLoading(false);
          return;
        }

        setVideo(videoRes.data as Video);

        if (userRes.data.user) {
          setUserId(userRes.data.user.id);

          // Fetch user profile for tier
          const { data: profile } = await supabase
            .from("users")
            .select("tier")
            .eq("id", userRes.data.user.id)
            .single();

          setUserTier((profile?.tier as "free" | "pro") ?? "free");
        } else {
          setUserTier("free");
        }
      } catch (err) {
        setError(String(err));
      }

      setLoading(false);
    }

    fetchData();
  }, [videoId]);

  // Increment view count once
  useEffect(() => {
    if (!video || viewIncrementedRef.current) return;
    viewIncrementedRef.current = true;

    supabase
      .from("videos")
      .update({ view_count: (video.view_count ?? 0) + 1 })
      .eq("id", videoId)
      .then(({ error }) => {
        if (!error) {
          setVideo((prev) => (prev ? { ...prev, view_count: prev.view_count + 1 } : prev));
        }
      });
  }, [video, videoId]);

  // Progress tracking: every 10s
  useEffect(() => {
    if (!video || !userId) return;

    progressIntervalRef.current = setInterval(() => {
      const el = videoRef.current;
      if (!el) return;

      const currentTime = Math.floor(el.currentTime);
      if (currentTime <= 0) return;

      supabase.from("video_progress").upsert(
        {
          user_id: userId,
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
  }, [video, videoId, userId]);

  // 60s preview check for free users on pro videos
  const isProVideo = video?.tier_required === "pro";
  const isFreeUser = userTier === "free";
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
          <span className="text-4xl">⚠️</span>
          <h2 className="mt-4 text-xl font-semibold text-text-primary">Failed to load video</h2>
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
          <span className="text-4xl">🎬</span>
          <h2 className="mt-4 text-xl font-semibold text-text-primary">Video not found</h2>
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
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Videos
      </Link>

      {/* Video player */}
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          src={video.storage_url}
          className="h-full w-full"
          controls
          controlsList="nodownload"
          onTimeUpdate={handleTimeUpdate}
          preload="metadata"
        />

        {/* Preview ended overlay */}
        {previewEnded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="rounded-sm border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold mb-4">
              {t("preview_ends")}
            </div>
            <h3 className="text-xl font-semibold text-white">{t("upgrade_to_watch")}</h3>
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
          <h1 className="text-2xl font-bold text-text-primary">
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
          <div className="mt-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("description")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {video.description[locale] ?? video.description["en-US"] ?? ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
