import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { UsersTable, UsersPageHeading } from "./UsersTable";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const client = createServiceRoleClient();

  const { data: users, error } = await client
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return <div className="text-red-400">Failed to load users. Please try again later.</div>;
  }

  return (
    <div>
      <UsersPageHeading />
      <UsersTable users={users ?? []} />
    </div>
  );
}
