import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import type { CommunityAuthor, CommunityPost } from "@/types";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10_000;

// GET: 单帖详情，给"点开看全文"的详情页用。跟列表接口一样必须用 service-role
// 查作者资料——public.users 的 RLS 只放行 auth.uid() = id。
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const viewerId = authData.user?.id ?? null;

    const serviceClient = createServiceRoleClient();

    const { data: post, error } = await serviceClient
      .from("community_posts")
      .select("id, author_id, title, content, cover_image, created_at, updated_at")
      .eq("id", id)
      .single();

    if (error || !post) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [{ data: author }, { data: reactions }, { data: comments }] = await Promise.all([
      serviceClient.from("users").select("id, display_name, avatar_url").eq("id", post.author_id).single(),
      serviceClient.from("community_reactions").select("user_id, emoji").eq("post_id", id),
      serviceClient.from("community_comments").select("id").eq("post_id", id),
    ]);

    const reactionCounts: Record<string, number> = {};
    const viewerReactions: string[] = [];
    for (const r of reactions ?? []) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] ?? 0) + 1;
      if (viewerId && r.user_id === viewerId) viewerReactions.push(r.emoji);
    }

    const data: CommunityPost = {
      ...post,
      author: (author as CommunityAuthor) ?? null,
      comment_count: comments?.length ?? 0,
      reaction_counts: reactionCounts,
      viewer_reactions: viewerReactions,
    };

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH: 编辑自己的帖子。不重新校验 Pro 等级——保住编辑权，即使订阅后来过期了。
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const coverImage = typeof body.cover_image === "string" && body.cover_image.trim() ? body.cover_image.trim() : null;

    if (!title || !content) {
      return NextResponse.json({ error: "title and content are required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH || content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: "title or content too long" }, { status: 400 });
    }
    if (coverImage && coverImage.length > 2048) {
      return NextResponse.json({ error: "cover_image too long" }, { status: 400 });
    }

    // 不暴露"这个帖子存在但不是你的"——跟 video_notes 的 404 惯例一致
    const { data: existing } = await supabase
      .from("community_posts")
      .select("author_id")
      .eq("id", id)
      .single();

    if (!existing || existing.author_id !== userId) {
      return NextResponse.json({ error: "Not found or not authorized" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("community_posts")
      .update({ title, content, cover_image: coverImage })
      .eq("id", id)
      .select("id, author_id, title, content, cover_image, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
