"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Video, VideoCategory, Locale } from "@/types";

const supabase = createClient();

function VideosContent() {
  const locale = useLocale() as Locale;
  const t = useTranslations("video.list");
  const tc = useTranslations("video.card");
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");

  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<VideoCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [videosRes, catsRes] = await Promise.all([
      supabase
        .from("videos")
        .select("*, category:video_categories(id, name, slug)")
        .eq("is_deleted", false)
        .order("sort_order", { ascending: true }),
      supabase
        .from("video_categories")
        .select("*")
        .order("sort_order", { ascending: true }),
    ]);

    if (videosRes.error) {
      setError(videosRes.error.message);
      setVideos([]);
    } else {
      setVideos((videosRes.data as Video[]) ?? []);
    }

    if (catsRes.error) {
      setCategories([]);
    } else {
      setCategories((catsRes.data as VideoCategory[]) ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = categoryParam
    ? videos.filter((v) => v.category?.slug === categoryParam)
    : videos;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <h1 className="text-3xl font-bold text-text-primary">{t("title")}</h1>
        <div className="mt-6 flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-sm" />
          ))}
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-md border border-border-default bg-bg-secondary">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-3 p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <h1 className="text-3xl font-bold text-text-primary">{t("title")}</h1>
        <EmptyState
          icon={<span className="text-4xl">⚠️</span>}
          title="Failed to load videos"
          description={error}
        />
      </div>
    );
  }

  const selectedCategory = categories.find((c) => c.slug === categoryParam);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-text-primary">{t("title")}</h1>
      </div>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/${locale}/videos`}
            className={`rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors ${
              !categoryParam
                ? "border-gold bg-gold/15 text-gold"
                : "border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover"
            }`}
          >
            {t("all_categories")}
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/${locale}/videos?category=${cat.slug}`}
              className={`rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors ${
                categoryParam === cat.slug
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover"
              }`}
            >
              {cat.name[locale] ?? cat.slug}
            </Link>
          ))}
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((video) => (
            <Link
              key={video.id}
              href={`/${locale}/videos/${video.id}`}
              className="group block"
            >
              <Card hover padding="none" className="overflow-hidden">
                <div className="relative aspect-video bg-bg-tertiary">
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt={video.title[locale] ?? ""}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-text-muted">
                      <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  )}
                  {video.duration_seconds > 0 && (
                    <span className="absolute bottom-2 right-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs text-white">
                      {formatDuration(video.duration_seconds)}
                    </span>
                  )}
                  <span className="absolute left-2 top-2">
                    <Badge variant={video.tier_required === "pro" ? "gold" : "gray"}>
                      {video.tier_required === "pro" ? tc("pro_badge") : tc("free_badge")}
                    </Badge>
                  </span>
                </div>

                <div className="p-4">
                  <h3 className="font-medium text-text-primary transition-colors group-hover:text-gold line-clamp-2">
                    {video.title[locale] ?? video.title["en-US"] ?? "Untitled"}
                  </h3>
                  <p className="mt-1.5 text-xs text-text-muted">
                    {tc("watch_count", { count: video.view_count })}
                  </p>
                  {video.category && (
                    <p className="mt-1 text-xs text-text-secondary">
                      {video.category.name[locale] ?? video.category.slug}
                    </p>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState
            icon={<span className="text-4xl">🎬</span>}
            title={videos.length > 0 ? t("empty_search") : t("empty")}
            description={
              categoryParam && selectedCategory
                ? `No videos found in "${selectedCategory.name[locale] ?? selectedCategory.slug}"`
                : "Videos will appear here once the admin uploads content."
            }
          />
        </div>
      )}
    </div>
  );
}

function VideosSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="h-9 w-48 animate-pulse rounded-sm bg-bg-tertiary" />
      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-sm" />
        ))}
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-md border border-border-default bg-bg-secondary">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VideosPage() {
  return (
    <Suspense fallback={<VideosSkeleton />}>
      <VideosContent />
    </Suspense>
  );
}
