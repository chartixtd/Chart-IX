import { createClient } from "./server";

/**
 * Route-handler auth in two strengths.
 *
 * "readonly"  — verifies the JWT locally against the project's JWKS
 *   (ES256 asymmetric signing is enabled; supabase-js caches the JWKS
 *   in-process). Zero network round trips. Use ONLY for read-only GET
 *   polling routes: a banned user's existing token stays valid for its
 *   remaining lifetime (≤1h) — approved trade-off, spec §4.
 *
 * "verified"  — full network check against Supabase Auth (revocation-aware).
 *   Required for every route with write semantics.
 */
export async function getApiUserId(mode: "readonly" | "verified"): Promise<string | null> {
  const supabase = await createClient();
  if (mode === "readonly") {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub as string;
  }
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
