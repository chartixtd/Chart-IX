import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { FeaturesTable } from "./FeaturesTable";

export const dynamic = "force-dynamic";

interface FeatureFlag {
  id: number;
  feature_key: string;
  feature_group: string;
  display_name: Record<string, string>;
  description: Record<string, string> | null;
  free_enabled: boolean;
  pro_enabled: boolean;
  updated_at: string;
}

export default async function AdminFeaturesPage() {
  const client = createServiceRoleClient();

  const { data: features, error } = await client
    .from("feature_flags")
    .select("*")
    .order("feature_group", { ascending: true })
    .order("feature_key", { ascending: true });

  if (error) {
    return <div className="text-red-400">Error loading features: {error.message}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Feature Flags</h1>
      <FeaturesTable features={(features ?? []) as FeatureFlag[]} />
    </div>
  );
}
