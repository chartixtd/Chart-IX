import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";

const VALID_LANGUAGES = ["zh-CN", "en-US", "ms-MY"];

/** 校验多语言 JSONB 字段（title / description） */
function isLocaleMap(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// POST - Create a new video
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const {
      title,
      description,
      category_id,
      storage_url,
      thumbnail_url,
      duration_seconds,
      file_size_bytes,
      tier_required,
      language,
    } = body;

    if (!storage_url) {
      return NextResponse.json({ error: "storage_url is required" }, { status: 400 });
    }
    if (!title || typeof title !== "object" || Object.keys(title).length === 0) {
      return NextResponse.json({ error: "title is required (non-empty JSON object)" }, { status: 400 });
    }
    if (language !== undefined && !VALID_LANGUAGES.includes(language)) {
      return NextResponse.json(
        { error: `language must be one of ${VALID_LANGUAGES.join(", ")}` },
        { status: 400 }
      );
    }

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("videos")
      .insert({
        title,
        description: description ?? null,
        category_id: category_id ?? null,
        storage_url,
        thumbnail_url: thumbnail_url ?? null,
        duration_seconds: duration_seconds ?? 0,
        file_size_bytes: file_size_bytes ?? null,
        tier_required: tier_required ?? "free",
        language: language ?? "en-US",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "create_video",
        targetType: "video",
        targetId: data?.id,
        oldValue: null,
        newValue: body,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH - Update video (title, description, category, thumbnail, duration, language, tier, soft delete)
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id, ...updates } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const allowedFields: Record<string, unknown> = {};
    if ("tier_required" in updates) {
      if (!["free", "pro"].includes(updates.tier_required)) {
        return NextResponse.json({ error: "tier_required must be 'free' or 'pro'" }, { status: 400 });
      }
      allowedFields.tier_required = updates.tier_required;
    }
    if ("language" in updates) {
      if (!VALID_LANGUAGES.includes(updates.language)) {
        return NextResponse.json(
          { error: `language must be one of ${VALID_LANGUAGES.join(", ")}` },
          { status: 400 }
        );
      }
      allowedFields.language = updates.language;
    }
    if ("title" in updates) {
      if (!isLocaleMap(updates.title) || Object.keys(updates.title).length === 0) {
        return NextResponse.json(
          { error: "title must be a non-empty JSON object" },
          { status: 400 }
        );
      }
      allowedFields.title = updates.title;
    }
    if ("description" in updates) {
      if (updates.description !== null && !isLocaleMap(updates.description)) {
        return NextResponse.json(
          { error: "description must be a JSON object or null" },
          { status: 400 }
        );
      }
      allowedFields.description = updates.description;
    }
    if ("category_id" in updates) {
      allowedFields.category_id = updates.category_id ?? null;
    }
    if ("thumbnail_url" in updates) {
      allowedFields.thumbnail_url = updates.thumbnail_url || null;
    }
    if ("duration_seconds" in updates) {
      const d = Number(updates.duration_seconds);
      if (!Number.isFinite(d) || d < 0) {
        return NextResponse.json(
          { error: "duration_seconds must be a non-negative number" },
          { status: 400 }
        );
      }
      allowedFields.duration_seconds = Math.floor(d);
    }
    if ("is_deleted" in updates) {
      allowedFields.is_deleted = updates.is_deleted;
      if (updates.is_deleted) {
        allowedFields.deleted_at = new Date().toISOString();
      } else {
        allowedFields.deleted_at = null;
      }
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const client = createServiceRoleClient();

    // Fetch old video data for audit logging
    const { data: oldData } = await client.from("videos").select("*").eq("id", id).single();

    const { error } = await client.from("videos").update(allowedFields).eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "update_video",
        targetType: "video",
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

// DELETE - Hard delete a video
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const client = createServiceRoleClient();

    // Fetch old video data for audit logging
    const { data: oldData } = await client.from("videos").select("*").eq("id", id).single();

    const { error } = await client.from("videos").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log (fire-and-forget)
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "delete_video",
        targetType: "video",
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
