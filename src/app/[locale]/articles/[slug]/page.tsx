import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ArticleDetailClient } from "./ArticleDetailClient";
import type { Article, Locale } from "@/types";

function stripHtml(html: string, maxLength = 160): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const supabase = await createClient();
  const { data: article } = await supabase
    .from("articles")
    .select("title, content, cover_image")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (!article) return {};

  const title = article.title[locale as Locale] ?? article.title["en-US"];
  const rawContent = article.content?.[locale as Locale] ?? article.content?.["en-US"] ?? "";
  const description = rawContent ? stripHtml(rawContent) : undefined;

  return {
    title,
    description,
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
  const supabase = await createClient();
  const [
    { data: article, error },
    { data: { user } },
  ] = await Promise.all([
    supabase
      .from("articles")
      .select("*, category:article_categories(id, name, slug)")
      .eq("slug", slug)
      .eq("is_published", true)
      .single(),
    supabase.auth.getUser(),
  ]);

  if (error || !article) notFound();

  let userTier: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("tier")
      .eq("id", user.id)
      .single();
    userTier = profile?.tier ?? "free";
  }

  const isProArticle = article.tier_required === "pro";
  const isFreeUser = !userTier || userTier === "free";
  const isGated = isProArticle && isFreeUser;

  // Server-side content gating: never send full pro content to free users
  let safeContent = article.content as Record<string, string>;
  if (isGated && safeContent) {
    safeContent = {};
    for (const [lang, html] of Object.entries(article.content as Record<string, string>)) {
      if (html) {
        safeContent[lang] = truncateHtmlAtMidpoint(html);
      }
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
