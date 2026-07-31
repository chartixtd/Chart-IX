import { createClient } from "@/lib/supabase/server";
import { VideosView } from "./VideosView";
import type { Video, VideoCategory } from "@/types";

export default async function VideosPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  const { category: categoryParam } = await searchParams;
  const supabase = await createClient();

  const [videosRes, catsRes] = await Promise.all([
    supabase
      .from("videos")
      .select("*, category:video_categories(id, name, slug)")
      .eq("is_deleted", false)
      .eq("language", locale)
      .order("sort_order", { ascending: true }),
    supabase
      .from("video_categories")
      .select("*")
      .order("sort_order", { ascending: true }),
  ]);

  return (
    <VideosView
      videos={(videosRes.data as Video[]) ?? []}
      videosError={videosRes.error?.message ?? null}
      categories={(catsRes.data as VideoCategory[]) ?? []}
      categoryParam={categoryParam ?? null}
    />
  );
}
