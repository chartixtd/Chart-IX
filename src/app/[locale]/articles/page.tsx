import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import ArticlesClient from "./ArticlesClient";
import ArticlesLoading from "./loading";
import type { Article, ArticleCategory } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "article" });
  return { title: t("title") };
}

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;

  const supabase = await createClient();

  const [{ data: articles, error: articlesErr }, { data: categories, error: catsErr }] =
    await Promise.all([
      supabase
        .from("articles")
        .select("*, category:article_categories(id, name, slug)")
        .eq("is_published", true)
        .order("published_at", { ascending: false }),
      supabase
        .from("article_categories")
        .select("*")
        .order("sort_order", { ascending: true }),
    ]);

  return (
    <Suspense fallback={<ArticlesLoading />}>
      <ArticlesClient
        articles={(articles as Article[]) ?? []}
        categories={(categories as ArticleCategory[]) ?? []}
        fetchError={articlesErr?.message ?? catsErr?.message ?? null}
      />
    </Suspense>
  );
}
