import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ArticleDetailClient } from "./ArticleDetailClient";
import type { Article } from "@/types";

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

  // Server-side: fetch article
  const supabase = await createClient();
  const { data: article, error } = await supabase
    .from("articles")
    .select("*, category:article_categories(id, name, slug)")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (error || !article) notFound();

  // Server-side: get user tier from session
  const { data: { user } } = await supabase.auth.getUser();
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
