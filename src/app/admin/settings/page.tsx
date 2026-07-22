import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { SettingsEditor } from "./SettingsEditor";

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

  if (error) {
    return <div className="text-red-400">Error loading settings: {error.message}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Site Settings</h1>
      <SettingsEditor settings={(settings ?? []) as AdminSetting[]} />
    </div>
  );
}
