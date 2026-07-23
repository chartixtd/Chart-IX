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
        <div className="text-red-400">Failed to load videos. Please try again later.</div>
      ) : (
        <VideosManager videos={videos} categories={categories} />
      )}
    </div>
  );
}
