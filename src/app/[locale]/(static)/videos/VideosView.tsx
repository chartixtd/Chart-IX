"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, FilterTabs, FILTER_TAB, FILTER_TAB_ACTIVE, FILTER_TAB_IDLE } from "@/components/ui/PageHeader";
import type { Video, VideoCategory, Locale } from "@/types";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 视频库（Read 面）。编辑式栅格：第一支视频占两列，其余三列排布。
 * 没有卡片描边——缩略图本身是那块「面」，标题与元信息落在它下面。
 */
export function VideosView({
  videos,
  videosError,
  categories,
}: {
  videos: Video[];
  videosError: string | null;
  categories: VideoCategory[];
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("video.list");
  const tc = useTranslations("video.card");
  const categoryParam = useSearchParams().get("category");

  if (videosError) {
    return (
      <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
        <PageHeader title={t("title")} />
        <EmptyState
          icon={<Icon name="alert" className="h-6 w-6" />}
          title="Failed to load videos"
          description={videosError}
        />
      </div>
    );
  }

  const filtered = categoryParam ? videos.filter((v) => v.category?.slug === categoryParam) : videos;
  const selectedCategory = categories.find((c) => c.slug === categoryParam);

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
      <PageHeader title={t("title")} className="pb-0 border-b-0" />

      {categories.length > 0 && (
        <div className="mt-8 border-b border-border-default">
          <FilterTabs>
            <Link
              href={`/${locale}/videos`}
              className={cn(FILTER_TAB, !categoryParam ? FILTER_TAB_ACTIVE : FILTER_TAB_IDLE)}
            >
              {t("all_categories")}
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/${locale}/videos?category=${cat.slug}`}
                className={cn(FILTER_TAB, categoryParam === cat.slug ? FILTER_TAB_ACTIVE : FILTER_TAB_IDLE)}
              >
                {cat.name[locale] ?? cat.slug}
              </Link>
            ))}
          </FilterTabs>
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((video, i) => {
            const lead = i === 0;
            return (
              <Link
                key={video.id}
                href={`/${locale}/videos/${video.id}`}
                className={cn("group block", lead && "sm:col-span-2")}
              >
                <div
                  className={cn(
                    "relative overflow-hidden rounded-lg border border-border-default bg-bg-tertiary transition-colors duration-500 group-hover:border-gold/40",
                    lead ? "aspect-[21/9]" : "aspect-video"
                  )}
                >
                  {video.thumbnail_url ? (
                    <Image
                      src={video.thumbnail_url}
                      alt={video.title[locale] ?? ""}
                      fill
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                      sizes={lead ? "(min-width: 1024px) 66vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"}
                      loading={lead ? "eager" : "lazy"}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-text-faint">
                      <Icon name="video" className="h-10 w-10" />
                    </div>
                  )}
                  <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-bg-primary/70 via-transparent to-transparent" />
                  {video.duration_seconds > 0 && (
                    <span className="absolute bottom-3 right-3 font-mono text-[11px] tabular-nums tracking-wider text-text-primary">
                      {formatDuration(video.duration_seconds)}
                    </span>
                  )}
                </div>

                <div className={cn("mt-5", lead && "sm:max-w-2xl")}>
                  <div className="flex items-center gap-3">
                    <Badge variant={video.tier_required === "pro" ? "gold" : "gray"}>
                      {video.tier_required === "pro" ? tc("pro_badge") : tc("free_badge")}
                    </Badge>
                    {video.category && (
                      <span className="eyebrow">{video.category.name[locale] ?? video.category.slug}</span>
                    )}
                  </div>
                  <h3
                    className={cn(
                      "mt-3 font-display font-medium tracking-tight text-text-primary transition-colors group-hover:text-gold line-clamp-2",
                      lead ? "text-2xl lg:text-3xl" : "text-lg"
                    )}
                  >
                    {video.title[locale] ?? video.title["en-US"] ?? "Untitled"}
                  </h3>
                  <p className="mt-2 font-mono text-[11px] tabular-nums text-text-muted">
                    {tc("watch_count", { count: video.view_count })}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState
            icon={<Icon name="video" className="h-6 w-6" />}
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
