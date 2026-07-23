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
 * Uses service_role to read the users table, bypassing RLS so tier/role
 * are always accurate (avoids the "pro user still sees upgrade" bug caused
 * by client-side RLS reads silently returning null).
 */
export async function getServerAuth(): Promise<ServerAuthState> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return EMPTY_AUTH;

    const serviceClient = createServiceRoleClient();
    const { data: profile } = await serviceClient
      .from("users")
      .select("tier, role")
      .eq("id", user.id)
      .single();

    return {
      userId: user.id,
      email: user.email ?? null,
      tier: (profile?.tier as "free" | "pro") ?? "free",
      role: (profile?.role as "user" | "admin") ?? "user",
      loading: false,
    };
  } catch {
    return EMPTY_AUTH;
  }
}
