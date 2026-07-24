import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const client = createServiceRoleClient();

    // Fetch old user data for audit logging
    const { data: oldData } = await client.from("users").select("*").eq("id", id).single();

    const { error } = await client.from("users").update(updates).eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "update_user",
        targetType: "user",
        targetId: id,
        oldValue: oldData,
        newValue: updates,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const client = createServiceRoleClient();

    // Fetch old user data for audit logging
    const { data: oldData } = await client.from("users").select("*").eq("id", id).single();

    const { error } = await client.from("users").delete().eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "delete_user",
        targetType: "user",
        targetId: id,
        oldValue: oldData,
        newValue: null,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { email, password, display_name, tier, role } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    const client = createServiceRoleClient();

    // Create auth user via Supabase Admin API
    const { data: authData, error: authError } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: display_name ?? null,
        tier: tier ?? "free",
        role: role ?? "user",
      },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (authData?.user) {
      // Upsert into public.users table with additional fields
      const { error: upsertError } = await client.from("users").upsert({
        id: authData.user.id,
        email,
        display_name: display_name ?? null,
        tier: tier ?? "free",
        role: role ?? "user",
      });

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "create_user",
        targetType: "user",
        targetId: authData?.user?.id,
        oldValue: null,
        newValue: { email, password: "[REDACTED]", display_name, tier, role },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
