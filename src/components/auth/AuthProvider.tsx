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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    userId: null,
    email: null,
    tier: null,
    role: null,
    loading: true,
  });

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
    fetchAuth();

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        fetchAuth();
      } else if (event === "SIGNED_OUT") {
        setAuth({ userId: null, email: null, tier: null, role: null, loading: false });
      }
    });

    return () => subscription.unsubscribe();
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
