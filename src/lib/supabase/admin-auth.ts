import { NextResponse } from "next/server";
import { createClient } from "./server";
import { createServiceRoleClient } from "./middleware";

/**
 * Gate for /api/admin/* route handlers.
 *
 * middleware.ts only protects page routes under /admin — it explicitly lets
 * everything under /api pass through untouched (see the `pathname.startsWith("/api")`
 * branch), so every admin API route must check this for itself. Call this first
 * thing in each handler and bail out on `"error" in result`.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("role, is_disabled")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin" || profile.is_disabled) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  return { user, supabase } as const;
}
