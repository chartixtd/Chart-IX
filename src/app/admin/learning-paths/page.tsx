import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { LearningPathsManager } from "./LearningPathsManager";
import type { LearningPath, LearningPathStep, Video } from "@/types";

export const dynamic = "force-dynamic";

type SlimVideo = Pick<Video, "id" | "title" | "duration_seconds" | "tier_required" | "is_deleted">;

export default async function AdminLearningPathsPage() {
  const client = createServiceRoleClient();

  const [pathsRes, stepsRes, videosRes] = await Promise.all([
    client.from("learning_paths").select("*").order("sort_order", { ascending: true }),
    client.from("learning_path_steps").select("*").order("sort_order", { ascending: true }),
    client
      .from("videos")
      .select("id, title, duration_seconds, tier_required, is_deleted")
      .eq("is_deleted", false)
      .order("title", { ascending: true }),
  ]);

  const paths = (pathsRes.data ?? []) as LearningPath[];
  const steps = (stepsRes.data ?? []) as LearningPathStep[];
  const videos = (videosRes.data ?? []) as SlimVideo[];
  const error = pathsRes.error?.message ?? stepsRes.error?.message ?? videosRes.error?.message ?? null;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">学习路径管理</h1>
      {error ? (
        <div className="text-red-400">Failed to load learning paths. Please try again later.</div>
      ) : (
        <LearningPathsManager paths={paths} steps={steps} videos={videos} />
      )}
    </div>
  );
}
