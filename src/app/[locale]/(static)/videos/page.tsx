import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { buildLanguageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { VideosView } from "./VideosView";
import VideosLoading from "./loading";
import type { Video, VideoCategory } from "@/types";

// Public catalog data, no per-user auth check — this uses the plain
// service-role client instead of the cookie-bound one so the page stays out
// of Next's dynamic-API opt-out, letting `revalidate` below actually apply.
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
      // sort_order 相同时（新上传的视频落在同一序号上）必须有稳定的次级排序，
      // 否则同分行的先后每次查询都可能不同，用户会看到"顺序自己在变"。
      .order("created_at", { ascending: false })
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
