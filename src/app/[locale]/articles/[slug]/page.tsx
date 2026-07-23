"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Article, Locale } from "@/types";

const supabase = createClient();

function truncateHtmlAtMidpoint(html: string): string {
  const midpoint = Math.floor(html.length / 2);

  const breakTags = ["</p>", "</h2>", "</h3>", "</h4>", "</li>", "</blockquote>", "</div>"];

  let bestPos = -1;

  for (const tag of breakTags) {
    let searchFrom = midpoint;
    let pos = html.lastIndexOf(tag, searchFrom);
    if (pos !== -1 && pos > bestPos) {
      bestPos = pos + tag.length;
    }
  }

  if (bestPos > 0) {
    return html.slice(0, bestPos);
  }

  return html.slice(0, midpoint);
}

export default function ArticleDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const locale = useLocale() as Locale;
  const t = useTranslations("article");
  const auth = useAuth();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const viewIncrementedRef = useRef(false);

  useEffect(() => {
    async function fetchArticle() {
      setLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const res = await supabase
          .from("articles")
          .select("*, category:article_categories(id, name, slug)")
          .eq("slug", slug)
          .eq("is_published", true)
          .single();

        if (res.error) {
          if (res.error.code === "PGRST116") {
            setNotFound(true);
          } else {
            setError(res.error.message);
          }
          setLoading(false);
          return;
        }

        setArticle(res.data as Article);
      } catch (err) {
        setError(String(err));
      }

      setLoading(false);
    }

    fetchArticle();
  }, [slug]);

  // Increment view count once
  useEffect(() => {
    if (!article || viewIncrementedRef.current) return;
    viewIncrementedRef.current = true;

    supabase
      .from("articles")
      .update({ view_count: (article.view_count ?? 0) + 1 })
      .eq("id", article.id)
      .then(({ error }) => {
        if (!error) {
          setArticle((prev) =>
            prev ? { ...prev, view_count: prev.view_count + 1 } : prev
          );
        }
      });
  }, [article]);

  const contentHtml = useMemo(() => {
    if (!article?.content) return "";
    return article.content[locale] ?? article.content["en-US"] ?? "";
  }, [article, locale]);

  const isProArticle = article?.tier_required === "pro";
  const isFreeUser = auth.tier === "free" || auth.tier === null;
  const isGated = isProArticle && isFreeUser;

  const truncatedHtml = useMemo(() => {
    if (!isGated || !contentHtml) return null;
    return truncateHtmlAtMidpoint(contentHtml);
  }, [isGated, contentHtml]);

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

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="mb-6 h-6 w-32" />
        <Skeleton className="mb-2 h-9 w-3/4" />
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="mb-8 aspect-video w-full rounded-lg" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-4xl">⚠️</span>
          <h2 className="mt-4 text-xl font-semibold text-text-primary">
            Failed to load article
          </h2>
          <p className="mt-2 text-text-muted">{error}</p>
          <Link href={`/${locale}/articles`}>
            <Button variant="outline" size="md" className="mt-6">
              ← {t("back_to_articles")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Not found state
  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-4xl">📄</span>
          <h2 className="mt-4 text-xl font-semibold text-text-primary">
            Article not found
          </h2>
          <p className="mt-2 text-text-muted">
            This article may have been removed or is not available.
          </p>
          <Link href={`/${locale}/articles`}>
            <Button variant="outline" size="md" className="mt-6">
              ← {t("back_to_articles")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!article) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Back link */}
      <Link
        href={`/${locale}/articles`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        {t("back_to_articles")}
      </Link>

      {/* Category breadcrumb */}
      {article.category && (
        <Link
          href={`/${locale}/articles?category=${article.category.slug}`}
          className="mb-3 inline-block text-sm font-medium text-gold hover:underline"
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
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {t("published")} {formatDate(article.published_at)}
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          {t("views", { count: article.view_count })}
        </span>
        <Badge variant={article.tier_required === "pro" ? "gold" : "green"} size="md">
          {article.tier_required === "pro" ? t("pro") : t("free")}
        </Badge>
      </div>

      {/* Cover image */}
      {article.cover_image ? (
        <div className="mt-6 overflow-hidden rounded-lg">
          <img
            src={article.cover_image}
            alt={article.title[locale] ?? ""}
            className="w-full object-cover"
          />
        </div>
      ) : (
        <div className="mt-6 flex h-48 items-center justify-center rounded-lg bg-bg-tertiary text-text-muted">
          <svg
            className="h-12 w-12"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
        </div>
      )}

      {/* Article content */}
      <div className="prose-custom mt-8">
        {isGated && truncatedHtml ? (
          <>
            {/* Visible portion */}
            <div
              dangerouslySetInnerHTML={{ __html: truncatedHtml }}
              className="prose prose-sm max-w-none text-text-primary"
            />

            {/* Pro gate blur overlay */}
            <div className="relative">
              <div className="absolute inset-0 -top-32 bg-gradient-to-t from-bg-primary via-bg-primary/80 to-transparent pointer-events-none" />

              <div className="relative flex flex-col items-center py-12 text-center">
                <div className="mb-2 rounded-sm border border-gold/30 bg-gold/10 px-4 py-2">
                  <span className="text-sm font-medium text-gold">
                    {t("pro_lock_title")}
                  </span>
                </div>
                <p className="mt-3 max-w-md text-text-secondary">
                  {t("pro_lock_desc")}
                </p>
                <Link href={`/${locale}/upgrade`} className="mt-6">
                  <Button variant="primary" size="lg">
                    ⚡ {t("upgrade_cta")}
                  </Button>
                </Link>
              </div>

              {/* Blurred content hint */}
              <div
                className="pointer-events-none select-none opacity-20 blur-sm"
                dangerouslySetInnerHTML={{
                  __html: contentHtml.slice(
                    truncatedHtml.length,
                    Math.min(truncatedHtml.length + 500, contentHtml.length)
                  ) + "...",
                }}
              />
            </div>
          </>
        ) : (
          <div
            dangerouslySetInnerHTML={{ __html: contentHtml }}
            className="prose prose-sm max-w-none text-text-primary"
          />
        )}
      </div>

      {/* Bottom CTA for gated articles */}
      {isGated && (
        <div className="mt-8 rounded-md border border-border-default bg-bg-secondary p-6 text-center">
          <h3 className="text-lg font-semibold text-text-primary">
            {t("pro_lock_title")}
          </h3>
          <p className="mt-2 text-text-secondary">{t("pro_lock_desc")}</p>
          <Link href={`/${locale}/upgrade`}>
            <Button variant="primary" size="lg" className="mt-4">
              ⚡ {t("upgrade_cta")}
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
