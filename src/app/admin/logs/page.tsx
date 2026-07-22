import { createServiceRoleClient } from "@/lib/supabase/middleware";
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
    return <div className="text-red-400">Error loading logs: {error.message}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Activity Logs</h1>
      <LogsTable logs={logs ?? []} />
    </div>
  );
}
