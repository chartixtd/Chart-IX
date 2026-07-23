import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { SettingsEditor } from "./SettingsEditor";
import { AdminPageHeading } from "../AdminPageHeading";

export const dynamic = "force-dynamic";

interface AdminSetting {
  id: number;
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export default async function AdminSettingsPage() {
  const client = createServiceRoleClient();

  const { data: settings, error } = await client
    .from("admin_settings")
    .select("*")
    .order("key", { ascending: true });

  return (
    <div>
      <AdminPageHeading
        titleKey="settings_list.title"
        resource="settings"
        errorMessage={error?.message}
      />
      {!error && <SettingsEditor settings={(settings ?? []) as AdminSetting[]} />}
    </div>
  );
}
