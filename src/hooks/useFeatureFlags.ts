"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

interface FeatureFlagRow {
  feature_key: string;
  free_enabled: boolean;
  pro_enabled: boolean;
}

function useAllFeatureFlags() {
  return useQuery({
    queryKey: ["feature-flags"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.from("feature_flags").select("feature_key, free_enabled, pro_enabled");
      return (data ?? []) as FeatureFlagRow[];
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Whether the current user can use a given feature flag.
 * Fails open (true) while flags are still loading or if the key isn't
 * configured at all, so a missing/misconfigured flag never silently locks
 * out a feature that was meant to be unrestricted.
 */
export function useFeatureAccess(key: string): { hasAccess: boolean; isPro: boolean; loading: boolean } {
  const auth = useAuth();
  const { data: flags, isLoading } = useAllFeatureFlags();
  const isPro = auth.tier === "pro";

  if (isLoading || auth.loading) return { hasAccess: true, isPro, loading: true };

  const flag = flags?.find((f) => f.feature_key === key);
  if (!flag) return { hasAccess: true, isPro, loading: false };

  return { hasAccess: isPro ? flag.pro_enabled : flag.free_enabled, isPro, loading: false };
}
