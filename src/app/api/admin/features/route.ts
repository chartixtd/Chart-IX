import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";

// PATCH - Update a feature flag by id
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id, free_enabled, pro_enabled } = await request.json();

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (typeof free_enabled === "boolean") updates.free_enabled = free_enabled;
    if (typeof pro_enabled === "boolean") updates.pro_enabled = pro_enabled;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const client = createServiceRoleClient();

    // Fetch old feature flag data for audit logging
    const { data: oldData } = await client.from("feature_flags").select("*").eq("id", id).single();

    const { error } = await client
      .from("feature_flags")
      .update(updates)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "update_feature",
        targetType: "feature",
        targetId: id,
        oldValue: oldData,
        newValue: updates,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
