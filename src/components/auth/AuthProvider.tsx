"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface AuthState {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  tier: "free" | "pro" | null;
  role: "user" | "admin" | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  /** Re-fetch auth state from Supabase — call after editing the user's own profile row. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  userId: null,
  email: null,
  displayName: null,
  tier: null,
  role: null,
  loading: true,
  refresh: async () => {},
});

// Survives AuthProvider remounts (route-group crossings re-mount the group
// layout). Hard loads start with null — matching the server-rendered HTML,
// so hydration is never affected; only client-side remounts read it.
// Server-side rendering MUST NEVER read or write this — it's a process-level
// module singleton shared across requests, so on the server it would leak
// one user's identity into another user's response (and could get baked into
// an ISR-cached HTML page).
let lastKnownAuth: AuthState | null = null;

export function AuthProvider({
  children,
  initialAuth,
}: {
  children: React.ReactNode;
  initialAuth?: AuthState;
}) {
  const queryClient = useQueryClient();

  // Module variable assignment is not setState — safe to run during render.
  // Guarded to the browser only: this function body also runs during SSR,
  // where writing to a module-level variable would leak across requests.
  // Also guarded to only fire when `initialAuth` is a *new* server snapshot
  // (ref identity changed), not merely because this component re-rendered
  // (e.g. from its own internal setAuth call). Without this guard, a
  // SIGNED_OUT setState would correctly clear lastKnownAuth, but the
  // resulting re-render would immediately run this line again with the
  // stale `initialAuth` prop and write the old (signed-in) state right
  // back — reviving a logged-out user's identity on the next remount.
  const seededAuthRef = useRef<AuthState | undefined>(undefined);
  if (typeof window !== "undefined" && initialAuth && seededAuthRef.current !== initialAuth) {
    seededAuthRef.current = initialAuth;
    lastKnownAuth = initialAuth;
  }

  // Server-prefetched auth is authoritative for first paint — no loading flash,
  // no client-side request waterfall, and tier/role are always accurate.
  const [auth, setAuthState] = useState<AuthState>(
    () =>
      initialAuth ??
      (typeof window !== "undefined" ? lastKnownAuth : null) ?? {
        userId: null,
        email: null,
        displayName: null,
        tier: null,
        role: null,
        loading: true,
      }
  );

  const setAuth = useCallback((next: AuthState) => {
    lastKnownAuth = next;
    setAuthState(next);
  }, []);

  const fetchAuth = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      setAuth({ userId: null, email: null, displayName: null, tier: null, role: null, loading: false });
      return;
    }

    // tier/role are synced onto app_metadata by a DB trigger (see
    // supabase/migrations/009_sync_tier_role_to_jwt_claims.sql), so getUser()
    // usually already has them. Fall back to a direct DB query (RLS allows
    // reading own row) if that migration hasn't been applied yet.
    let tier = user.app_metadata?.tier as "free" | "pro" | undefined;
    let role = user.app_metadata?.role as "user" | "admin" | undefined;
    let displayName =
      (user.app_metadata?.display_name as string | null | undefined) ?? null;

    if (tier === undefined || role === undefined) {
      const { data: profile } = await supabase
        .from("users")
        .select("tier, role, display_name")
        .eq("id", user.id)
        .single();

      tier = (profile?.tier as "free" | "pro") ?? "free";
      role = (profile?.role as "user" | "admin") ?? "user";
      displayName = profile?.display_name ?? null;
    }

    setAuth({
      userId: user.id,
      email: user.email ?? null,
      displayName,
      tier,
      role,
      loading: false,
    });
  }, []);

  useEffect(() => {
    // Fetch auth on mount if server didn't provide a valid user identity.
    // `initialAuth` is always an object (even when user is null), so check
    // `userId` rather than truthiness of the prop itself.
    const hasServerAuth = Boolean((initialAuth ?? lastKnownAuth)?.userId);
    if (!hasServerAuth) {
      fetchAuth();
    }

    // Supabase fires INITIAL_SESSION once on subscribe. When the server already
    // handed us the same session, re-fetching it is a wasted round trip on every
    // page load — skip that first one and keep honoring every later event.
    let initialSessionSettled = hasServerAuth;

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION" && initialSessionSettled) {
        initialSessionSettled = false;
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        fetchAuth();
        if (event === "SIGNED_IN") {
          // Idempotent (grant_achievement no-ops if already earned) — safe to call every sign-in.
          supabase.rpc("grant_achievement", { p_key: "first_login" }).then(() => {});
        }
      } else if (event === "SIGNED_OUT") {
        setAuth({ userId: null, email: null, displayName: null, tier: null, role: null, loading: false });
        // 账户类缓存（模拟盘/交易/成就等）若不清，换号后会短暂串到下一个用户；
        // 极端时序下 PaperTpSlWatcher 可能基于上一个账号的仓位缓存触发平仓。
        queryClient.clear();
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAuth, queryClient]);

  return (
    <AuthContext.Provider value={{ ...auth, refresh: fetchAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Hook that only returns true when auth is loaded and a condition is met */
export function useAuthFlag(flag: "isPro" | "isAdmin" | "isLoggedIn"): boolean {
  const auth = useAuth();
  if (auth.loading) return false;
  switch (flag) {
    case "isPro": return auth.tier === "pro";
    case "isAdmin": return auth.role === "admin";
    case "isLoggedIn": return auth.userId !== null;
  }
}
