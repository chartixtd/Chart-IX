import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { VideosManager } from "./VideosManager";
import { VideosHeading } from "./VideosHeading";

export const dynamic = "force-dynamic";

export default async function AdminVideosPage() {
  const client = createServiceRoleClient();

  const [videosRes, categoriesRes] = await Promise.all([
    client
      .from("videos")
      .select("*, category:video_categories(id, name, slug)")
      .order("sort_order", { ascending: true })
      // 与前台 /videos 用同一套次级排序，后台看到的顺序才等于用户看到的顺序
      .order("created_at", { ascending: false }),
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
        <div className="text-danger">Failed to load videos. Please try again later.</div>
      ) : (
        <VideosManager videos={videos} categories={categories} />
      )}
    </div>
  );
}
