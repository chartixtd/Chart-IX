import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { buildLanguageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import ArticlesClient from "./ArticlesClient";
import ArticlesLoading from "./loading";
import type { Article, ArticleCategory } from "@/types";

// Public catalog data, no per-user auth check — see the matching comment in
// src/app/[locale]/learn/page.tsx for why this uses the service-role client
// instead of the cookie-bound one. (The Pro-gated Community tab rendered
// inside ArticlesClient reads auth client-side via AuthProvider, not here.)
export const revalidate = 300;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "article" });
  return { title: t("title"), alternates: { languages: buildLanguageAlternates("/articles") } };
}

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;

  const supabase = createServiceRoleClient();

  const [{ data: articles, error: articlesErr }, { data: categories, error: catsErr }] =
    await Promise.all([
      supabase
        .from("articles")
        // `content` is the multi-locale article HTML body — several KB per
        // language, and never rendered on this listing page (only on the
        // detail page). Excluding it keeps this query and its cached
        // response small.
        .select("id, slug, title, category_id, cover_image, author_id, tier_required, view_count, is_published, published_at, created_at, updated_at, category:article_categories(id, name, slug)")
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(200),
      supabase
        .from("article_categories")
        .select("*")
        .order("sort_order", { ascending: true }),
    ]);

  return (
    <Suspense fallback={<ArticlesLoading />}>
      {/* Article.content isn't in the query above (unused on this listing page)
          — ArticlesClient never reads it, only .title/.cover_image/etc. */}
      <ArticlesClient
        articles={(articles as unknown as Article[]) ?? []}
        categories={(categories as ArticleCategory[]) ?? []}
        fetchError={articlesErr?.message ?? catsErr?.message ?? null}
      />
    </Suspense>
  );
}
