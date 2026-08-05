import { createServiceRoleClient } from "./middleware";

/**
 * Look up a user's tier straight from public.users via service role, rather
 * than trusting auth.jwt() app_metadata — 009_sync_tier_role_to_jwt_claims.sql
 * syncs tier into the JWT as an optional perf optimization and isn't
 * guaranteed to have run in every environment, so this is the one source
 * that's always correct. Mirrors the lookup in
 * src/app/api/video/stream/[id]/route.ts.
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
