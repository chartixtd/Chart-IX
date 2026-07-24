import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { logAdminAction } from "@/lib/supabase/admin-log";

/** Replace all steps for a path with the given ordered list of video ids. */
async function replaceSteps(
  client: ReturnType<typeof createServiceRoleClient>,
  pathId: number,
  videoIds: string[]
) {
  await client.from("learning_path_steps").delete().eq("path_id", pathId);
  if (videoIds.length === 0) return null;

  const rows = videoIds.map((video_id, index) => ({
    path_id: pathId,
    video_id,
    sort_order: index,
  }));
  const { error } = await client.from("learning_path_steps").insert(rows);
  return error;
}

// POST - Create a new learning path (with steps)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { slug, title, description, cover_image, level, is_published, sort_order, video_ids } = body;

    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }
    if (!title || typeof title !== "object" || Object.keys(title).length === 0) {
      return NextResponse.json({ error: "title is required (non-empty JSON object)" }, { status: 400 });
    }
    if (level && !["beginner", "intermediate", "advanced"].includes(level)) {
      return NextResponse.json({ error: "invalid level" }, { status: 400 });
    }

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("learning_paths")
      .insert({
        slug,
        title,
        description: description ?? null,
        cover_image: cover_image ?? null,
        level: level ?? "beginner",
        is_published: is_published ?? false,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `A path with slug "${slug}" already exists` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (Array.isArray(video_ids) && video_ids.length > 0) {
      const stepError = await replaceSteps(client, data.id, video_ids);
      if (stepError) return NextResponse.json({ error: stepError.message }, { status: 500 });
    }

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "create_learning_path",
        targetType: "learning_path",
        targetId: String(data.id),
        oldValue: null,
        newValue: body,
      });
    } catch { /* logging failure should never break the response */ }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

// PATCH - Update a learning path (optionally replacing its steps)
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id, video_ids, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const allowedFields: Record<string, unknown> = {};
    if ("slug" in updates) allowedFields.slug = updates.slug;
    if ("title" in updates) allowedFields.title = updates.title;
    if ("description" in updates) allowedFields.description = updates.description;
    if ("cover_image" in updates) allowedFields.cover_image = updates.cover_image;
    if ("level" in updates) {
      if (!["beginner", "intermediate", "advanced"].includes(updates.level)) {
        return NextResponse.json({ error: "invalid level" }, { status: 400 });
      }
      allowedFields.level = updates.level;
    }
    if ("is_published" in updates) allowedFields.is_published = updates.is_published;
    if ("sort_order" in updates) allowedFields.sort_order = updates.sort_order;

    const client = createServiceRoleClient();

    const { data: oldData } = await client.from("learning_paths").select("*").eq("id", id).single();

    if (Object.keys(allowedFields).length > 0) {
      allowedFields.updated_at = new Date().toISOString();
      const { error } = await client.from("learning_paths").update(allowedFields).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (Array.isArray(video_ids)) {
      const stepError = await replaceSteps(client, id, video_ids);
      if (stepError) return NextResponse.json({ error: stepError.message }, { status: 500 });
    }

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "update_learning_path",
        targetType: "learning_path",
        targetId: String(id),
        oldValue: oldData,
        newValue: { ...updates, video_ids },
      });
    } catch { /* logging failure should never break the response */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

// DELETE - Delete a learning path (steps cascade via FK)
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const client = createServiceRoleClient();
    const { data: oldData } = await client.from("learning_paths").select("*").eq("id", id).single();
    const { error } = await client.from("learning_paths").delete().eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "delete_learning_path",
        targetType: "learning_path",
        targetId: String(id),
        oldValue: oldData,
        newValue: null,
      });
    } catch { /* logging failure should never break the response */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
