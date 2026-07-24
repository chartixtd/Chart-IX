import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a URL-safe slug from the English title (or first available title). */
function generateSlug(title: Record<string, string>): string {
  // Prefer English, then fall back to the first available locale
  const source = title["en-US"] ?? title["zh-CN"] ?? title["ms-MY"] ?? "";
  return source
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// POST - Create a new article
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const {
      slug: rawSlug,
      title,
      content,
      category_id,
      cover_image,
      tier_required,
      is_published,
    } = body;

    // --- Validation ---

    if (!title || typeof title !== "object" || Object.keys(title).length === 0) {
      return NextResponse.json(
        { error: "title is required (non-empty JSON object)" },
        { status: 400 }
      );
    }

    const slug =
      rawSlug && typeof rawSlug === "string" && rawSlug.length > 0
        ? rawSlug
        : generateSlug(title as Record<string, string>);

    if (!slug || slug.length === 0) {
      return NextResponse.json(
        { error: "Could not generate a valid slug from the title" },
        { status: 400 }
      );
    }

    if (tier_required && !["free", "pro"].includes(tier_required)) {
      return NextResponse.json(
        { error: "tier_required must be 'free' or 'pro'" },
        { status: 400 }
      );
    }

    const author_id = auth.user.id;

    // --- Insert ---

    const published_at =
      is_published === true ? new Date().toISOString() : null;

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("articles")
      .insert({
        slug,
        title,
        content: content ?? null,
        category_id: category_id ?? null,
        cover_image: cover_image ?? null,
        author_id,
        tier_required: tier_required ?? "free",
        is_published: is_published ?? false,
        published_at,
      })
      .select()
      .single();

    if (error) {
      // Handle duplicate slug
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `An article with the slug "${slug}" already exists` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // --- Audit log (fire-and-forget) ---

    try {
      await logAdminAction({
        adminId: author_id,
        action: "create_article",
        targetType: "article",
        targetId: data?.id,
        oldValue: null,
        newValue: body,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH - Update an article
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id, ...updates } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const allowedFields: Record<string, unknown> = {};

    if ("slug" in updates) {
      if (typeof updates.slug !== "string" || updates.slug.length === 0) {
        return NextResponse.json(
          { error: "slug must be a non-empty string" },
          { status: 400 }
        );
      }
      allowedFields.slug = updates.slug;
    }
    if ("title" in updates) {
      if (
        typeof updates.title !== "object" ||
        updates.title === null ||
        Object.keys(updates.title).length === 0
      ) {
        return NextResponse.json(
          { error: "title must be a non-empty JSON object" },
          { status: 400 }
        );
      }
      allowedFields.title = updates.title;
    }
    if ("content" in updates) {
      allowedFields.content = updates.content;
    }
    if ("category_id" in updates) {
      allowedFields.category_id = updates.category_id;
    }
    if ("cover_image" in updates) {
      allowedFields.cover_image = updates.cover_image;
    }
    if ("tier_required" in updates) {
      if (!["free", "pro"].includes(updates.tier_required)) {
        return NextResponse.json(
          { error: "tier_required must be 'free' or 'pro'" },
          { status: 400 }
        );
      }
      allowedFields.tier_required = updates.tier_required;
    }
    if ("is_published" in updates) {
      allowedFields.is_published = updates.is_published;
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const client = createServiceRoleClient();

    // Fetch old article data for audit logging and published_at logic
    const { data: oldData, error: fetchError } = await client
      .from("articles")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.code === "PGRST116" ? "Article not found" : fetchError.message },
        { status: fetchError.code === "PGRST116" ? 404 : 500 }
      );
    }

    // If is_published is being set to true and published_at is null, set it
    if (
      allowedFields.is_published === true &&
      oldData &&
      !oldData.published_at
    ) {
      allowedFields.published_at = new Date().toISOString();
    }

    const { error } = await client
      .from("articles")
      .update(allowedFields)
      .eq("id", id);

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `An article with that slug already exists` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // --- Audit log (fire-and-forget) ---

    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "update_article",
        targetType: "article",
        targetId: id,
        oldValue: oldData,
        newValue: updates,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE - Hard delete an article
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "id query parameter is required" },
        { status: 400 }
      );
    }

    const client = createServiceRoleClient();

    // Fetch old article data for audit logging
    const { data: oldData, error: fetchError } = await client
      .from("articles")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const { error } = await client.from("articles").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // --- Audit log (fire-and-forget) ---

    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const adminId = user?.id ?? "unknown";
      await logAdminAction({
        adminId,
        action: "delete_article",
        targetType: "article",
        targetId: id,
        oldValue: oldData,
        newValue: null,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
