"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { useContinueWatching, useLatestVideos } from "@/hooks/useDashboardData";
import { Skeleton } from "@/components/ui/Skeleton";
import { DashSection, DashNote } from "./Section";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types";

/** 两张并排。第三张在 390px 上只会变成三条挤在一起的缩略图 */
const MAX_CARDS = 2;

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M9 6.2 18.2 12 9 17.8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function LessonCard({
  href,
  title,
  thumbnail,
  seconds,
  tag,
  progress,
}: {
  href: string;
  title: string;
  thumbnail: string | null;
  seconds: number;
  /** 「继续观看」或分类名。没有就不渲染那一行 */
  tag?: string;
  /** 0–1。只有继续观看的卡有 */
  progress?: number;
}) {
  return (
    <Link href={href} className="group flex flex-col gap-2.5">
      <span className="relative block aspect-video overflow-hidden rounded-lg border border-border-default bg-bg-secondary">
        {thumbnail ? (
          <Image
            src={thumbnail}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, 240px"
            className="object-cover opacity-80 transition-opacity group-hover:opacity-100"
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center">
          <PlayGlyph className="h-7 w-7 text-gold" />
        </span>
        {seconds > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-bg-primary/80 px-1.5 py-[2px] font-mono text-[10px] tabular-nums text-text-secondary">
            {duration(seconds)}
          </span>
        )}
        {progress !== undefined && (
          // 只动 transform：scaleX 不触发重排
          <span aria-hidden className="absolute inset-x-0 bottom-0 block h-[2px] bg-border-default">
            <span
              className="block h-full origin-left bg-gold"
              style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }}
            />
          </span>
        )}
      </span>

      {tag && <span className="text-[11px] text-gold">{tag}</span>}
      <span
        className={cn(
          "line-clamp-2 text-[13px] font-medium leading-snug text-text-primary",
          !tag && "mt-0"
        )}
      >
        {title}
      </span>
    </Link>
  );
}

/**
 * 学习区：先给「你看到一半的」，没有就给「最新的」。
 *
 * 缩略图是这一区的主体。此前这一区只画一条百分比细线，`thumbnail_url` 明明
 * 已经在查询里却没被用上——一门课长什么样，缩略图比一条线说得清楚。
 */
export function LearningSection() {
  const locale = useLocale() as Locale;
  const t = useTranslations("dashboard");
  const auth = useAuth();

  const { data: continueWatching, isPending } = useContinueWatching(auth.userId);
  const resumable = (continueWatching ?? []).filter((item) => item.video);
  // 一节都没开始过的人看最新的几节，而不是看一句「暂无」
  const { data: latest } = useLatestVideos(!isPending && resumable.length === 0 && !!auth.userId);

  const cards = resumable.length
    ? resumable.slice(0, MAX_CARDS).map((item) => ({
        id: item.video!.id,
        title: item.video!.title[locale] ?? item.video!.title["en-US"],
        thumbnail: item.video!.thumbnail_url,
        seconds: item.video!.duration_seconds,
        tag: t("continue_watching_tag"),
        progress: item.video!.duration_seconds
          ? item.progress_seconds / item.video!.duration_seconds
          : 0,
      }))
    : (latest ?? []).slice(0, MAX_CARDS).map((video) => ({
        id: video.id,
        title: video.title[locale] ?? video.title["en-US"],
        thumbnail: video.thumbnail_url,
        seconds: video.duration_seconds,
        tag: undefined,
        progress: undefined,
      }));

  return (
    <DashSection
      title={t("learning_title")}
      action={
        <Link
          href={`/${locale}/learn`}
          className="shrink-0 text-[13px] text-gold transition-colors hover:text-gold-hover"
        >
          {t("learning_cta")}
        </Link>
      }
    >
      <p className="-mt-2 mb-4 text-[13px] text-text-muted">{t("learning_subtitle")}</p>

      {isPending ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: MAX_CARDS }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-lg" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <DashNote>
          {t("continue_learning_empty")}{" "}
          <Link href={`/${locale}/learn`} className="link-underline text-gold">
            {t("continue_learning_cta")}
          </Link>
        </DashNote>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {cards.map((card) => (
            <LessonCard key={card.id} href={`/${locale}/videos/${card.id}`} {...card} />
          ))}
        </div>
      )}
    </DashSection>
  );
}
