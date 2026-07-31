import type { MetadataRoute } from "next";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { PUBLIC_LOCALES, SITE_URL } from "@/lib/constants";

const STATIC_PATHS = ["", "/videos", "/articles", "/trade", "/learn", "/upgrade", "/login", "/register"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const client = createServiceRoleClient();

  const [{ data: articles }, { data: videos }, { data: paths }] = await Promise.all([
    client.from("articles").select("slug, updated_at").eq("is_published", true),
    client.from("videos").select("id, updated_at").eq("is_deleted", false),
    client.from("learning_paths").select("slug, updated_at").eq("is_published", true),
  ]);

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of PUBLIC_LOCALES) {
    for (const path of STATIC_PATHS) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        changeFrequency: "weekly",
        priority: path === "" ? 1 : 0.7,
      });
    }
    for (const a of articles ?? []) {
      entries.push({
        url: `${SITE_URL}/${locale}/articles/${a.slug}`,
        lastModified: a.updated_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
    for (const v of videos ?? []) {
      entries.push({
        url: `${SITE_URL}/${locale}/videos/${v.id}`,
        lastModified: v.updated_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
    for (const p of paths ?? []) {
      entries.push({
        url: `${SITE_URL}/${locale}/learn/${p.slug}`,
        lastModified: p.updated_at ?? undefined,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  return entries;
}
