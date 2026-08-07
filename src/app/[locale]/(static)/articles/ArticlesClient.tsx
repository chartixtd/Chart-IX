"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CommunityFeed } from "@/components/community/CommunityFeed";
import { cn } from "@/lib/utils";
import type { Article, ArticleCategory, Locale } from "@/types";

interface ArticlesClientProps {
  articles: Article[];
  categories: ArticleCategory[];
  fetchError: string | null;
}

function formatDate(dateStr: string, localeStr: string) {
  try {
    return new Intl.DateTimeFormat(localeStr, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export default function ArticlesClient({
  articles,
  categories,
  fetchError,
}: ArticlesClientProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("article");
  const tCommunity = useTranslations("community");
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  // 从帖子详情页点"返回社区"回来时带 ?tab=community，得读出来选中对应 tab，
  // 不然每次都会掉回默认的 articles 分栏
  const [tab, setTab] = useState<"articles" | "community">(
    searchParams.get("tab") === "community" ? "community" : "articles"
  );

  const filtered = useMemo(() => {
    if (!categoryParam) return articles;
    return articles.filter((a) => a.category?.slug === categoryParam);
  }, [articles, categoryParam]);

  // Error state
  if (fetchError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <h1 className="text-3xl font-bold text-text-primary">{t("title")}</h1>
        <div className="mt-8">
          <EmptyState
            icon={<span className="text-4xl">⚠️</span>}
            title="Failed to load articles"
            description={fetchError}
          />
        </div>
      </div>
    );
  }

  const selectedCategory = categories.find((c) => c.slug === categoryParam);
  // "News" now lives on its own /news page (live RSS feed), so drop it from the tabs here
  const visibleCategories = categories.filter((c) => c.slug !== "news");

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-3xl font-bold text-text-primary">{t("title")}</h1>

      {/* Articles vs. user-posted Community — kept as separate tabs rather than
          one merged feed, so curated multi-locale articles don't get buried
          under single-locale user posts (or vice versa). */}
      <div className="mt-6 flex gap-1 rounded-sm bg-bg-tertiary p-1 w-fit">
        {(["articles", "community"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-xs px-4 py-1.5 text-sm font-medium transition-colors",
              tab === key ? "bg-bg-primary text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {key === "articles" ? t("title") : tCommunity("tab_label")}
          </button>
        ))}
      </div>

      {tab === "community" && (
        <div className="mt-6">
          <CommunityFeed />
        </div>
      )}

      {/* Category filter tabs */}
      {tab === "articles" && visibleCategories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/${locale}/articles`}
            className={`rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors ${
              !categoryParam
                ? "border-gold bg-gold/15 text-gold"
                : "border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover"
            }`}
          >
            {t("all_categories")}
          </Link>
          {visibleCategories.map((cat) => (
            <Link
              key={cat.id}
              href={`/${locale}/articles?category=${cat.slug}`}
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

      {/* Articles grid */}
      {tab === "articles" && (filtered.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((article) => (
            <Link
              key={article.id}
              href={`/${locale}/articles/${article.slug}`}
              className="group block"
            >
              <Card hover padding="none" className="overflow-hidden">
                {/* Cover image */}
                <div className="relative aspect-video bg-bg-tertiary">
                  {article.cover_image ? (
                    <Image
                      src={article.cover_image}
                      alt={article.title[locale] ?? ""}
                      fill
                      className="object-cover"
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-text-muted">
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
                  {/* Tier badge */}
                  <span className="absolute left-2 top-2">
                    <Badge
                      variant={
                        article.tier_required === "pro" ? "gold" : "green"
                      }
                    >
                      {article.tier_required === "pro" ? t("pro") : t("free")}
                    </Badge>
                  </span>
                </div>

                <div className="p-4">
                  {/* Category label */}
                  {article.category && (
                    <p className="text-xs font-medium text-gold">
                      {article.category.name[locale] ?? article.category.slug}
                    </p>
                  )}

                  {/* Title */}
                  <h3 className="mt-1 font-medium text-text-primary transition-colors group-hover:text-gold line-clamp-2">
                    {article.title[locale] ??
                      article.title["en-US"] ??
                      "Untitled"}
                  </h3>

                  {/* Meta */}
                  <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
                    {article.published_at && (
                      <span>{formatDate(article.published_at, locale)}</span>
                    )}
                    <span>{t("views", { count: article.view_count })}</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        /* Empty state */
        <div className="mt-8">
          <EmptyState
            icon={<span className="text-4xl">📰</span>}
            title={articles.length > 0 ? t("empty_search") : t("no_articles")}
            description={
              categoryParam && selectedCategory
                ? `No articles found in "${selectedCategory.name[locale] ?? selectedCategory.slug}"`
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
