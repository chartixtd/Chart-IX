import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getTranslations } from "next-intl/server";
import { VideosManager } from "./VideosManager";
import { VideosHeading } from "./VideosHeading";

export const dynamic = "force-dynamic";

export default async function AdminVideosPage() {
  const t = await getTranslations("admin");
  const client = createServiceRoleClient();

  const [videosRes, categoriesRes] = await Promise.all([
    client
      .from("videos")
      .select("*, category:video_categories(id, name, slug)")
      .order("sort_order", { ascending: true }),
    client
      .from("video_categories")
      .select("*")
      .order("sort_order", { ascending: true }),
  ]);

  const videos = videosRes.data ?? [];
  const categories = categoriesRes.data ?? [];
  const error = videosRes.error?.message ?? categoriesRes.error?.message ?? null;

  return (
    <div>
      <VideosHeading />
      {error ? (
        <div className="text-red-400">{t("error_loading", { resource: "videos" })}</div>
      ) : (
        <VideosManager videos={videos} categories={categories} />
      )}
    </div>
  );
}
