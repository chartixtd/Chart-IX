import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { RiskEditor } from "./RiskEditor";

export const dynamic = "force-dynamic";

export default async function AdminRiskPage() {
  const client = createServiceRoleClient();

  const { data: configs, error } = await client
    .from("risk_config")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    return <div className="text-red-400">Error loading risk configs: {error.message}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Risk Control</h1>
      <RiskEditor configs={configs ?? []} />
    </div>
  );
}
