"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, FilterTabs, FILTER_TAB, FILTER_TAB_ACTIVE, FILTER_TAB_IDLE } from "@/components/ui/PageHeader";
import { CommunityFeed } from "@/components/community/CommunityFeed";
import { cn } from "@/lib/utils";
import type { Article, ArticleCategory, Locale } from "@/types";
import { Icon } from "@/components/ui/Icon";

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

/**
 * 文章（Read 面）。头条一篇横排：左图右文；其余三列栅格。
 * 分类是下划线标签，文章与社区是同一条基线上的两个大标签。
 */
export default function ArticlesClient({ articles, categories, fetchError }: ArticlesClientProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("article");
  const tCommunity = useTranslations("community");
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  const [tab, setTab] = useState<"articles" | "community">(
    searchParams.get("tab") === "community" ? "community" : "articles"
  );

  const filtered = useMemo(() => {
    if (!categoryParam) return articles;
    return articles.filter((a) => a.category?.slug === categoryParam);
  }, [articles, categoryParam]);

  if (fetchError) {
    return (
      <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
        <PageHeader title={t("title")} />
        <div className="mt-8">
          <EmptyState icon={<Icon name="alert" className="h-6 w-6" />} title="Failed to load articles" description={fetchError} />
        </div>
      </div>
    );
  }

  const selectedCategory = categories.find((c) => c.slug === categoryParam);
  const visibleCategories = categories.filter((c) => c.slug !== "news");
  const [lead, ...rest] = filtered;

  const ArticleMeta = ({ article }: { article: Article }) => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant={article.tier_required === "pro" ? "gold" : "gray"}>
        {article.tier_required === "pro" ? t("pro") : t("free")}
      </Badge>
      {article.category && <span className="eyebrow">{article.category.name[locale] ?? article.category.slug}</span>}
    </div>
  );

  const ArticleFooter = ({ article }: { article: Article }) => (
    <p className="mt-3 font-mono text-[11px] tabular-nums text-text-muted">
      {article.published_at && <span>{formatDate(article.published_at, locale)}</span>}
      {article.published_at && <span className="mx-2 text-text-faint">/</span>}
      <span>{t("views", { count: article.view_count })}</span>
    </p>
  );

  const Cover = ({ article, className }: { article: Article; className?: string }) => (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border-default bg-bg-tertiary transition-colors duration-500 group-hover:border-gold/40",
        className
      )}
    >
      {article.cover_image ? (
        <Image
          src={article.cover_image}
          alt={article.title[locale] ?? ""}
          fill
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-text-faint">
          <Icon name="article" className="h-10 w-10" />
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
      <PageHeader title={t("title")} className="pb-0 border-b-0" />

      {/* 一级：文章 / 社区 */}
      <div className="mt-8 border-b border-border-default">
        <FilterTabs>
          {(["articles", "community"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(FILTER_TAB, "text-xs", tab === key ? FILTER_TAB_ACTIVE : FILTER_TAB_IDLE)}
            >
              {key === "articles" ? t("title") : tCommunity("tab_label")}
            </button>
          ))}
        </FilterTabs>
      </div>

      {tab === "community" && (
        <div className="mt-8">
          <CommunityFeed />
        </div>
      )}

      {/* 二级：分类 */}
      {tab === "articles" && visibleCategories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/${locale}/articles`}
            className={cn(
              "rounded-sm border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors",
              !categoryParam ? "border-gold/60 text-gold" : "border-border-default text-text-muted hover:border-border-strong hover:text-text-primary"
            )}
          >
            {t("all_categories")}
          </Link>
          {visibleCategories.map((cat) => (
            <Link
              key={cat.id}
              href={`/${locale}/articles?category=${cat.slug}`}
              className={cn(
                "rounded-sm border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors",
                categoryParam === cat.slug
                  ? "border-gold/60 text-gold"
                  : "border-border-default text-text-muted hover:border-border-strong hover:text-text-primary"
              )}
            >
              {cat.name[locale] ?? cat.slug}
            </Link>
          ))}
        </div>
      )}

      {tab === "articles" &&
        (filtered.length > 0 ? (
          <>
            {/* 头条 */}
            {lead && (
              <Link href={`/${locale}/articles/${lead.slug}`} className="group mt-12 grid gap-8 lg:grid-cols-12 lg:items-center">
                <Cover article={lead} className="aspect-[16/9] lg:col-span-7 lg:aspect-[3/2]" />
                <div className="lg:col-span-5">
                  <ArticleMeta article={lead} />
                  <h2 className="display mt-5 text-display-md font-normal transition-colors group-hover:text-gold">
                    {lead.title[locale] ?? lead.title["en-US"] ?? "Untitled"}
                  </h2>
                  <ArticleFooter article={lead} />
                </div>
              </Link>
            )}

            {rest.length > 0 && (
              <div className="mt-16 grid gap-x-6 gap-y-12 border-t border-border-default pt-12 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((article) => (
                  <Link key={article.id} href={`/${locale}/articles/${article.slug}`} className="group block">
                    <Cover article={article} className="aspect-video" />
                    <div className="mt-5">
                      <ArticleMeta article={article} />
                      <h3 className="mt-3 font-display text-lg font-medium tracking-tight text-text-primary transition-colors group-hover:text-gold line-clamp-2">
                        {article.title[locale] ?? article.title["en-US"] ?? "Untitled"}
                      </h3>
                      <ArticleFooter article={article} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mt-8">
            <EmptyState
              icon={<Icon name="article" className="h-6 w-6" />}
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
