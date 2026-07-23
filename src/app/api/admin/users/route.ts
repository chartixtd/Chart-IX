import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

export async function PATCH(request: NextRequest) {
  try {
    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const client = createServiceRoleClient();
    const { error } = await client.from("users").update(updates).eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const client = createServiceRoleClient();
    const { error } = await client.from("users").delete().eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
