import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { LogsHeading } from "./LogsHeading";
import { LogsTable } from "./LogsTable";

export const dynamic = "force-dynamic";

export default async function AdminLogsPage() {
  const client = createServiceRoleClient();

  const { data: logs, error } = await client
    .from("admin_logs")
    .select("*, users:admin_id(email)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="text-red-400">
        Failed to load logs. Please try again later.
      </div>
    );
  }

  return (
    <div>
      <LogsHeading />
      <LogsTable logs={logs ?? []} />
    </div>
  );
}
