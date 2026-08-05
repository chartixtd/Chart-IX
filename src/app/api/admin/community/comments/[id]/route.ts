import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { requireAdmin } from "@/lib/supabase/admin-auth";

// DELETE: 管理员删除任意评论（内容审核）
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id } = await params;
    const serviceClient = createServiceRoleClient();

    const { error } = await serviceClient.from("community_comments").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAction({
      adminId: auth.user.id,
      action: "delete_community_comment",
      targetType: "community_comment",
      targetId: id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
