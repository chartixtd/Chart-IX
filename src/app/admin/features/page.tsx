import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { FeaturesTable } from "./FeaturesTable";
import { FeaturesHeading } from "./FeaturesHeading";

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
      <FeaturesHeading />
      <FeaturesTable features={(features ?? []) as FeatureFlag[]} />
    </div>
  );
}
