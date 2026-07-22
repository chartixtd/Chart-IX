import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ user: null });
    }

    // Use service_role to query users table (bypasses RLS)
    const client = createServiceRoleClient();
    const { data: profile } = await client
      .from("users")
      .select("role, tier, display_name")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      user: {
        email: user.email,
        displayName: profile?.display_name ?? user.email?.split("@")[0],
        role: profile?.role ?? "user",
        tier: profile?.tier ?? "free",
      },
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
