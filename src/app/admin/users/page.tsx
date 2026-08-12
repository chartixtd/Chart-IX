import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { UsersTable, UsersPageHeading } from "./UsersTable";

export const dynamic = "force-dynamic";

const USERS_PER_PAGE = 20;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const search = params.search || "";
  const offset = (page - 1) * USERS_PER_PAGE;

  const client = createServiceRoleClient();

  let query = client
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (search) {
    query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
  }

  const { data: users, error, count } = await query.range(offset, offset + USERS_PER_PAGE - 1);

  if (error) {
    return <div className="text-danger">Failed to load users. Please try again later.</div>;
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / USERS_PER_PAGE));

  return (
    <div>
      <UsersPageHeading />
      <UsersTable users={users ?? []} currentPage={page} totalPages={totalPages} search={search} />
    </div>
  );
}
