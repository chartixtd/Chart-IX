import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { revalidatePath } from "next/cache";
import { UsersTable } from "./UsersTable";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const client = createServiceRoleClient();

  const { data: users, error } = await client
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return <div className="text-red-400">Error loading users: {error.message}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Users</h1>
      <UsersTable users={users ?? []} />
    </div>
  );
}
