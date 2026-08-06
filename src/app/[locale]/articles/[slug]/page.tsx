import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTier } from "@/lib/supabase/get-user-tier";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import { buildLanguageAlternates } from "@/lib/seo";
import { ArticleDetailClient } from "./ArticleDetailClient";
import type { Article, Locale } from "@/types";

function stripHtml(html: string, maxLength = 160): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

// React's request-scoped cache: generateMetadata and the page body both need
// this article, and without this they'd run the query twice — cache() here
// makes the second call reuse the first call's result within the same request.
const getArticleBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  return supabase
    .from("articles")
    .select("*, category:article_categories(id, name, slug)")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const { data: article } = await getArticleBySlug(slug);

  if (!article) return {};

  const title = article.title[locale as Locale] ?? article.title["en-US"];
  const rawContent = article.content?.[locale as Locale] ?? article.content?.["en-US"] ?? "";
  const description = rawContent ? stripHtml(rawContent) : undefined;

  return {
    title,
    description,
    // `slug` is locale-invariant (one row/one slug, per-locale title+content
    // in JSONB columns — see supabase/migrations/007_articles.sql), so the
    // same slug is the correct alternate URL in every locale.
    alternates: { languages: buildLanguageAlternates(`/articles/${slug}`) },
    openGraph: {
      title,
      description,
      type: "article",
      images: article.cover_image ? [article.cover_image] : undefined,
    },
    twitter: { title, description },
  };
}

function truncateHtmlAtMidpoint(html: string): string {
  const midpoint = Math.floor(html.length / 2);
  const breakTags = ["</p>", "</h2>", "</h3>", "</h4>", "</li>", "</blockquote>", "</div>"];

  let bestPos = -1;
  for (const tag of breakTags) {
    const pos = html.lastIndexOf(tag, midpoint);
    if (pos !== -1 && pos > bestPos) bestPos = pos + tag.length;
  }
  return bestPos > 0 ? html.slice(0, bestPos) : html.slice(0, midpoint);
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug } = await params;

  // The article lookup and the session read don't depend on each other, so
  // they go out together — only the tier lookup has to wait for the user id.
  // The article half of this is shared with generateMetadata via cache().
  const supabase = await createClient();
  const [
    { data: article, error },
    { data: { user } },
  ] = await Promise.all([
    getArticleBySlug(slug),
    supabase.auth.getUser(),
  ]);

  if (error || !article) notFound();

  // Shared with the community/community-comments tier checks — see
  // src/lib/supabase/get-user-tier.ts for why this always reads public.users
  // directly rather than trusting the (optionally stale) JWT claim.
  const userTier = user ? await getUserTier(user.id) : null;

  const isProArticle = article.tier_required === "pro";
  const isFreeUser = !userTier || userTier === "free";
  const isGated = isProArticle && isFreeUser;

  // Sanitize every locale's HTML before it ever reaches a render — this is
  // the last point before the content leaves the server, so it must happen
  // here rather than in the client component (see sanitizeArticleHtml doc).
  const sanitizedContent: Record<string, string> = {};
  for (const [lang, html] of Object.entries(article.content as Record<string, string>)) {
    if (html) sanitizedContent[lang] = sanitizeArticleHtml(html);
  }

  // Server-side content gating: never send full pro content to free users
  let safeContent = sanitizedContent;
  if (isGated) {
    safeContent = {};
    for (const [lang, html] of Object.entries(sanitizedContent)) {
      safeContent[lang] = truncateHtmlAtMidpoint(html);
    }
  }

  const safeArticle: Article = {
    ...article,
    content: safeContent,
  };

  return (
    <ArticleDetailClient
      article={safeArticle}
      isGated={isGated}
    />
  );
}
