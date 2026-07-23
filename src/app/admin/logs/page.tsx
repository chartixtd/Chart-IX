import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { LogsHeading } from "./LogsHeading";
import { LogsTable } from "./LogsTable";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AdminLogsPage() {
  const t = await getTranslations("admin");
  const client = createServiceRoleClient();

  const { data: logs, error } = await client
    .from("admin_logs")
    .select("*, users:admin_id(email)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="text-red-400">
        {t("error_loading", { resource: "logs" })}
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
