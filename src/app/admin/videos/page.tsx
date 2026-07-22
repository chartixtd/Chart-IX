import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { VideosManager } from "./VideosManager";

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
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Videos</h1>
      {error ? (
        <div className="text-red-400">Error loading data: {error}</div>
      ) : (
        <VideosManager videos={videos} categories={categories} />
      )}
    </div>
  );
}
