import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";

/** 与前台 /videos 页的 .limit(300) 对齐——超过这个量级就该分页而不是拖拽了 */
const MAX_IDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH - 整批重排视频顺序
 *
 * 客户端必须传**完整**的 id 列表（不是当前页的切片）。只传一页会让其它页
 * 的 sort_order 停在旧值，两批序号交错，列表看起来会随机跳。
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json().catch(() => null);
    const ids: unknown = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ error: `ids must contain at most ${MAX_IDS} items` }, { status: 400 });
    }
    if (!ids.every((id): id is string => typeof id === "string" && UUID_RE.test(id))) {
      return NextResponse.json({ error: "ids must all be UUIDs" }, { status: 400 });
    }
    // 重复 id 会让 UPDATE ... FROM 的匹配行取到任意一条序号，结果不可预测。
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "ids must be unique" }, { status: 400 });
    }

    const client = createServiceRoleClient();

    // 一条 SQL 整批生效（见 045_videos_reorder.sql）。逐行 update 在中途
    // 失败时会留下半套顺序，那比不改更糟。
    const { data: updated, error } = await client.rpc("reorder_videos", { p_ids: ids });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      await logAdminAction({
        adminId: user?.id ?? "unknown",
        action: "reorder_videos",
        targetType: "video",
        // 这条操作不针对单个视频，targetId 留空
        // 存完整顺序而不是"某条移到第几位"：出问题时这份快照能直接还原
        newValue: { order: ids, updated },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
