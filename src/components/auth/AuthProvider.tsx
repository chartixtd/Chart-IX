"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AuthState {
  userId: string | null;
  email: string | null;
  tier: "free" | "pro" | null;
  role: "user" | "admin" | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({
  userId: null,
  email: null,
  tier: null,
  role: null,
  loading: true,
});

export function AuthProvider({
  children,
  initialAuth,
}: {
  children: React.ReactNode;
  initialAuth?: AuthState;
}) {
  // Server-prefetched auth is authoritative for first paint — no loading flash,
  // no client-side request waterfall, and tier/role are always accurate.
  const [auth, setAuth] = useState<AuthState>(
    initialAuth ?? {
      userId: null,
      email: null,
      tier: null,
      role: null,
      loading: true,
    }
  );

  const fetchAuth = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      setAuth({ userId: null, email: null, tier: null, role: null, loading: false });
      return;
    }

    // Single direct DB query (RLS allows reading own row)
    const { data: profile } = await supabase
      .from("users")
      .select("tier, role")
      .eq("id", user.id)
      .single();

    setAuth({
      userId: user.id,
      email: user.email ?? null,
      tier: (profile?.tier as "free" | "pro") ?? "free",
      role: (profile?.role as "user" | "admin") ?? "user",
      loading: false,
    });
  }, []);

  useEffect(() => {
    // Only fetch on mount if the server didn't already provide auth
    if (!initialAuth) {
      fetchAuth();
    }

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        fetchAuth();
      } else if (event === "SIGNED_OUT") {
        setAuth({ userId: null, email: null, tier: null, role: null, loading: false });
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAuth]);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
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
