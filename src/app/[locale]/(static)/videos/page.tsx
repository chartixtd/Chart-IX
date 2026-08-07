import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { buildLanguageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { VideosView } from "./VideosView";
import VideosLoading from "./loading";
import type { Video, VideoCategory } from "@/types";

// Public catalog data, no per-user auth check — see the matching comment in
// src/app/[locale]/(static)/learn/page.tsx for why this uses the service-role client
// instead of the cookie-bound one.
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
  const t = await getTranslations({ locale, namespace: "video.list" });
  return { title: t("title"), alternates: { languages: buildLanguageAlternates("/videos") } };
}

export default async function VideosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = createServiceRoleClient();

  const [videosRes, catsRes] = await Promise.all([
    supabase
      .from("videos")
      // `storage_url`/`description`/`file_size_bytes` aren't rendered on this
      // grid — only the detail page needs the actual playback URL.
      .select("id, title, category_id, language, thumbnail_url, duration_seconds, tier_required, view_count, sort_order, created_at, category:video_categories(id, name, slug)")
      .eq("is_deleted", false)
      .eq("language", locale)
      .order("sort_order", { ascending: true })
      .limit(300),
    supabase
      .from("video_categories")
      .select("*")
      .order("sort_order", { ascending: true }),
  ]);

  return (
    <Suspense fallback={<VideosLoading />}>
      {/* Video.storage_url/description/etc. aren't in the query above (unused
          on this grid) — VideosView never reads them, only the fields listed. */}
      <VideosView
        videos={(videosRes.data as unknown as Video[]) ?? []}
        videosError={videosRes.error?.message ?? null}
        categories={(catsRes.data as VideoCategory[]) ?? []}
      />
    </Suspense>
  );
}
