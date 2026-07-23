import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { RiskEditor } from "./RiskEditor";
import { AdminPageHeading } from "../AdminPageHeading";

export const dynamic = "force-dynamic";

export default async function AdminRiskPage() {
  const client = createServiceRoleClient();

  const { data: configs, error } = await client
    .from("risk_config")
    .select("*")
    .order("id", { ascending: true });

  return (
    <div>
      <AdminPageHeading
        titleKey="risk_list.title"
        resource="risk configs"
        errorMessage={error?.message}
      />
      {!error && <RiskEditor configs={configs ?? []} />}
    </div>
  );
}
