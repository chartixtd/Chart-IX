import { createServiceRoleClient } from "@/lib/supabase/middleware";

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

  const stats = [
    { label: "Total Users", value: total.count ?? 0, color: "text-blue-400" },
    { label: "Free Users", value: free.count ?? 0, color: "text-text-secondary" },
    { label: "Pro Users", value: pro.count ?? 0, color: "text-gold" },
    { label: "New Today", value: today.count ?? 0, color: "text-green-400" },
    { label: "Disabled", value: disabled.count ?? 0, color: "text-red-400" },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border-default bg-bg-secondary p-4">
            <p className="text-sm text-text-muted">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
