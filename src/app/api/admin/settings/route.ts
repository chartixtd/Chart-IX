import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createClient } from "@/lib/supabase/server";

// GET - Return all settings
export async function GET() {
  try {
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("admin_settings")
      .select("*")
      .order("key", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH - Update a setting by id
export async function PATCH(request: NextRequest) {
  try {
    const { id, value } = await request.json();

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (value === undefined) return NextResponse.json({ error: "value required" }, { status: 400 });

    const client = createServiceRoleClient();

    // Fetch old setting data for audit logging
    const { data: oldData } = await client.from("admin_settings").select("*").eq("id", id).single();

    const { error } = await client
      .from("admin_settings")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "update_setting",
        targetType: "setting",
        targetId: id,
        oldValue: oldData,
        newValue: { value },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST - Create a new setting
export async function POST(request: NextRequest) {
  try {
    const { key, value, description } = await request.json();

    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    if (value === undefined) return NextResponse.json({ error: "value required" }, { status: 400 });

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("admin_settings")
      .insert({
        key,
        value,
        description: description ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "create_setting",
        targetType: "setting",
        targetId: data?.id,
        oldValue: null,
        newValue: { key, value, description },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE - Delete a setting by id
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const client = createServiceRoleClient();

    // Fetch old setting data for audit logging
    const { data: oldData } = await client.from("admin_settings").select("*").eq("id", id).single();

    const { error } = await client.from("admin_settings").delete().eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "delete_setting",
        targetType: "setting",
        targetId: id,
        oldValue: oldData,
        newValue: null,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
