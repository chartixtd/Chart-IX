import type { MetadataRoute } from "next";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { PUBLIC_LOCALES, SITE_URL } from "@/lib/constants";
import { buildLanguageAlternates } from "@/lib/seo";

// /login and /register are excluded on purpose — auth pages have nothing for
// a crawler to index and shouldn't compete with real content for crawl budget.
const STATIC_PATHS = ["", "/videos", "/articles", "/trade", "/learn", "/upgrade"];

// Safety cap: sitemaps are limited to 50,000 URLs (Google's protocol limit,
// which Next.js also enforces). Each of these queries was previously
// unbounded, so unlimited growth here would eventually break the whole
// sitemap route rather than just stop listing the newest items — capping per
// entity keeps that failure mode from ever happening for a single content type.
const MAX_ENTRIES_PER_TYPE = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const client = createServiceRoleClient();

  const [{ data: articles }, { data: videos }, { data: paths }] = await Promise.all([
    client.from("articles").select("slug, updated_at").eq("is_published", true).limit(MAX_ENTRIES_PER_TYPE),
    client.from("videos").select("id, updated_at").eq("is_deleted", false).limit(MAX_ENTRIES_PER_TYPE),
    client.from("learning_paths").select("slug, updated_at").eq("is_published", true).limit(MAX_ENTRIES_PER_TYPE),
  ]);

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of PUBLIC_LOCALES) {
    for (const path of STATIC_PATHS) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        changeFrequency: "weekly",
        priority: path === "" ? 1 : 0.7,
        alternates: { languages: buildLanguageAlternates(path) },
      });
    }
    // articles/learning_paths share one row per item across all locales
    // (slug is locale-invariant — see supabase/migrations/007_articles.sql),
    // so every locale's alternate is the same slug under a different prefix.
    for (const a of articles ?? []) {
      entries.push({
        url: `${SITE_URL}/${locale}/articles/${a.slug}`,
        lastModified: a.updated_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.6,
        alternates: { languages: buildLanguageAlternates(`/articles/${a.slug}`) },
      });
    }
    for (const p of paths ?? []) {
      entries.push({
        url: `${SITE_URL}/${locale}/learn/${p.slug}`,
        lastModified: p.updated_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.6,
        alternates: { languages: buildLanguageAlternates(`/learn/${p.slug}`) },
      });
    }
    // Videos are authored in one language each (videos.language column) and
    // don't have a cross-locale equivalent, so no alternates here — same
    // reasoning as skipping hreflang on the video detail page itself.
    for (const v of videos ?? []) {
      entries.push({
        url: `${SITE_URL}/${locale}/videos/${v.id}`,
        lastModified: v.updated_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  }

  return entries;
}
