import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Reused across calls within the same lambda instance instead of opening a
// fresh client (and its underlying connection pool) on every request — this
// is called ~100+ times per request lifecycle across the codebase.
let cached: SupabaseClient | null = null;

export function createServiceRoleClient(): SupabaseClient {
  if (!cached) {
    cached = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return cached;
}
