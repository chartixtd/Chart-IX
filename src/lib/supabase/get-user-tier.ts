import { createServiceRoleClient } from "./middleware";

/**
 * Look up a user's tier straight from public.users via service role, rather
 * than trusting auth.jwt() app_metadata — 009_sync_tier_role_to_jwt_claims.sql
 * syncs tier into the JWT as an optional perf optimization and isn't
 * guaranteed to have run in every environment, so this is the one source
 * that's always correct. Shared by every route/page that needs a guaranteed-
 * fresh tier for gating (video streaming, article content gating, community
 * posting) — src/lib/supabase/get-auth.ts's getServerAuth() is the one
 * exception, since it deliberately prefers the JWT claim as a fast path for
 * non-gating display purposes and only falls back to this same table read.
 */
export async function getUserTier(userId: string): Promise<"free" | "pro" | null> {
  const serviceClient = createServiceRoleClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("tier")
    .eq("id", userId)
    .single();
  return (profile?.tier as "free" | "pro" | undefined) ?? null;
}
