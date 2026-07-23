import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { AdminDashboardClient } from "@/components/admin/AdminDashboardClient";

interface Stats {
  total: number;
  free: number;
  pro: number;
  today: number;
  disabled: number;
}

export default async function AdminDashboard() {
  const client = createServiceRoleClient();

  const [total, free, pro, today, disabled] = await Promise.all([
    client.from("users").select("id", { count: "exact", head: true }),
    client.from("users").select("id", { count: "exact", head: true }).eq("tier", "free"),
    client.from("users").select("id", { count: "exact", head: true }).eq("tier", "pro"),
    client
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
    client
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("is_disabled", true),
  ]);

  const stats: Stats = {
    total: total.count ?? 0,
    free: free.count ?? 0,
    pro: pro.count ?? 0,
    today: today.count ?? 0,
    disabled: disabled.count ?? 0,
  };

  return <AdminDashboardClient stats={stats} />;
}
