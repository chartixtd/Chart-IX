import { cache } from "react";
import { createClient } from "./server";
import { createServiceRoleClient } from "./middleware";

export interface ServerAuthState {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  tier: "free" | "pro" | null;
  role: "user" | "admin" | null;
  loading: boolean;
}

const EMPTY_AUTH: ServerAuthState = {
  userId: null,
  email: null,
  displayName: null,
  tier: null,
  role: null,
  loading: false,
};

/**
 * Fetch the current user's auth state on the server.
 *
 * tier/role/display_name are all kept in sync onto auth.users.app_metadata
 * by a DB trigger (migrations 009 + 039), so getUser() alone carries the
 * complete, real-time auth state in a single round trip. If those
 * migrations haven't been applied, app_metadata simply lacks the fields
 * and we transparently fall back to the service_role table read.
 *
 * Wrapped in React cache(): layout + page calling this in the same request
 * only pay for one execution.
 */
export const getServerAuth = cache(async (): Promise<ServerAuthState> => {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return EMPTY_AUTH;

    let tier = user.app_metadata?.tier as "free" | "pro" | undefined;
    let role = user.app_metadata?.role as "user" | "admin" | undefined;
    let displayName =
      (user.app_metadata?.display_name as string | null | undefined) ?? null;

    if (tier === undefined || role === undefined) {
      const serviceClient = createServiceRoleClient();
      const { data: profile } = await serviceClient
        .from("users")
        .select("tier, role, display_name")
        .eq("id", user.id)
        .single();

      tier = (profile?.tier as "free" | "pro") ?? "free";
      role = (profile?.role as "user" | "admin") ?? "user";
      displayName = profile?.display_name ?? null;
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      displayName,
      tier,
      role,
      loading: false,
    };
  } catch {
    return EMPTY_AUTH;
  }
});
