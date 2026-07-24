import { createClient } from "./server";
import { createServiceRoleClient } from "./middleware";

export interface ServerAuthState {
  userId: string | null;
  email: string | null;
  tier: "free" | "pro" | null;
  role: "user" | "admin" | null;
  loading: boolean;
}

const EMPTY_AUTH: ServerAuthState = {
  userId: null,
  email: null,
  tier: null,
  role: null,
  loading: false,
};

/**
 * Fetch the current user's auth state on the server.
 *
 * `tier`/`role` are kept in sync onto `auth.users.app_metadata` by a DB
 * trigger (see supabase/migrations/009_sync_tier_role_to_jwt_claims.sql),
 * so `getUser()` alone already carries accurate, real-time tier/role and we
 * can skip the second DB round trip. If that migration hasn't been applied
 * yet, `app_metadata` simply won't have these fields and we transparently
 * fall back to the service_role table read — same behavior as before,
 * just without the speedup.
 */
export async function getServerAuth(): Promise<ServerAuthState> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return EMPTY_AUTH;

    const claimTier = user.app_metadata?.tier as "free" | "pro" | undefined;
    const claimRole = user.app_metadata?.role as "user" | "admin" | undefined;

    let tier = claimTier;
    let role = claimRole;

    if (tier === undefined || role === undefined) {
      const serviceClient = createServiceRoleClient();
      const { data: profile } = await serviceClient
        .from("users")
        .select("tier, role")
        .eq("id", user.id)
        .single();

      tier = (profile?.tier as "free" | "pro") ?? "free";
      role = (profile?.role as "user" | "admin") ?? "user";
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      tier,
      role,
      loading: false,
    };
  } catch {
    return EMPTY_AUTH;
  }
}
