import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cached per browser tab — createClient() is called from many independent
// components, and each call used to spin up its own GoTrue instance (its
// own auth-state listener + token-refresh timer), not just its own client.
let cached: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (!cached) {
    cached = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return cached;
}
