"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Article, Locale } from "@/types";

const supabase = createClient();

interface Props {
  article: Article;
  isGated: boolean;
}

export function ArticleDetailClient({ article, isGated }: Props) {
  const locale = useLocale() as Locale;
  const t = useTranslations("article");
  const viewIncrementedRef = useRef(false);
  const [viewCount, setViewCount] = useState(article.view_count);

  // Increment view count once on mount
  useEffect(() => {
    if (viewIncrementedRef.current) return;
    viewIncrementedRef.current = true;

    supabase
      .from("articles")
      .update({ view_count: (article.view_count ?? 0) + 1 })
      .eq("id", article.id)
      .then(({ error }) => {
        if (!error) setViewCount((prev) => prev + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Already sanitized server-side (see sanitizeArticleHtml in the [slug]
  // server component) before it was ever embedded into the rendered page.
  const contentHtml =
    article.content?.[locale] ??
    article.content?.["en-US"] ??
    "";

  const formatDate = (dateStr: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Loading fallback for client-side hydration */}
      <Link
        href={`/${locale}/articles`}
        className="mb-6 flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t("back_to_articles")}
      </Link>

      {/* Category breadcrumb */}
      {article.category && (
        <Link
          href={`/${locale}/articles?category=${article.category.slug}`}
          className="mb-3 block w-fit text-sm font-medium text-gold hover:underline"
        >
          {article.category.name[locale] ?? article.category.slug}
        </Link>
      )}

      {/* Title */}
      <h1 className="text-3xl font-bold text-text-primary leading-tight">
        {article.title[locale] ?? article.title["en-US"] ?? "Untitled"}
      </h1>

      {/* Meta row */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-text-secondary">
        {article.published_at && (
          <span className="flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {t("published")} {formatDate(article.published_at)}
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {t("views", { count: viewCount })}
        </span>
        <Badge variant={article.tier_required === "pro" ? "gold" : "green"} size="md">
          {article.tier_required === "pro" ? t("pro") : t("free")}
        </Badge>
      </div>

      {/* Cover image */}
      {article.cover_image ? (
        // aspect-[21/9] gives the fill-based Image a definite box (was
        // width-only sizing with natural aspect ratio on the plain <img>).
        <div className="relative mt-6 aspect-[21/9] overflow-hidden rounded-lg">
          <Image
            src={article.cover_image}
            alt={article.title[locale] ?? ""}
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 768px, 100vw"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="mt-6 flex h-48 items-center justify-center rounded-lg bg-bg-tertiary text-text-muted">
          <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
        </div>
      )}

      {/* Article content — server-side gated, no DOM hiding tricks */}
      {/* 阅读宽度收窄到 68ch，正文用 15px 行高 1.75，照顾移动端中文/马来文长文阅读 */}
      <div className="prose-custom mx-auto mt-8 max-w-[68ch] py-6 lg:py-12">
        <div
          dangerouslySetInnerHTML={{ __html: contentHtml }}
          className="prose prose-sm max-w-none text-[15px] leading-[1.75] text-text-primary lg:text-base"
        />

        {isGated && (
          <>
            {/* Pro gate CTA */}
            <div className="relative mt-4 flex flex-col items-center rounded-md border border-gold/30 bg-bg-secondary py-10 text-center">
              <div className="mb-2 rounded-sm border border-gold/30 bg-gold/10 px-4 py-2">
                <span className="text-sm font-medium text-gold">{t("pro_lock_title")}</span>
              </div>
              <p className="mt-3 max-w-md text-text-secondary">{t("pro_lock_desc")}</p>
              <Link href={`/${locale}/upgrade`} className="mt-6">
                <Button variant="primary" size="lg">⚡ {t("upgrade_cta")}</Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
