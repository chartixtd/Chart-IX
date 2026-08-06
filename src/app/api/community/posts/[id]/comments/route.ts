import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getUserTier } from "@/lib/supabase/get-user-tier";
import { checkRateLimit } from "@/lib/trading/rate-limit";
import type { CommunityAuthor, CommunityComment } from "@/types";

const MAX_CONTENT_LENGTH = 2_000;
const COMMENT_RATE_LIMIT = { windowMs: 20_000, max: 1 };
// Unbounded before — a heavily-discussed post could return thousands of
// rows in one response. Cap at the most recent N, restored to chronological
// (oldest-first) order for display, so the common case (<200 comments)
// renders identically to before.
const MAX_COMMENTS = 200;

// GET: 某个帖子下最近 MAX_COMMENTS 条评论，附带作者安全字段（同 posts route
// 的理由，用 service-role 绕开 public.users 只放行本人的 RLS）。
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: postId } = await params;
    const serviceClient = createServiceRoleClient();

    const { data: recent, error } = await serviceClient
      .from("community_comments")
      .select("id, post_id, author_id, content, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(MAX_COMMENTS);

    const comments = recent ? [...recent].reverse() : recent;

    if (error) {
      console.error("[community/comments GET]", error);
      return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
    }
    if (!comments || comments.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const authorIds = [...new Set(comments.map((c) => c.author_id))];
    const { data: authors } = await serviceClient
      .from("users")
      .select("id, display_name, avatar_url")
      .in("id", authorIds);
    const authorById = new Map<string, CommunityAuthor>((authors ?? []).map((a) => [a.id, a]));

    const data: CommunityComment[] = comments.map((c) => ({
      ...c,
      author: authorById.get(c.author_id) ?? null,
    }));

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[community/comments GET]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

// POST: 发评论，仅 Pro 用户，每人每 20 秒最多 1 条。
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: postId } = await params;
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tier = await getUserTier(userId);
    if (tier !== "pro") {
      return NextResponse.json({ error: "pro_required" }, { status: 403 });
    }

    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: "content too long" }, { status: 400 });
    }

    const rate = await checkRateLimit(`community-comment:${userId}`, COMMENT_RATE_LIMIT);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rate.retryAfterMs },
        { status: 429 }
      );
    }

    const { data, error } = await supabase
      .from("community_comments")
      .insert({ post_id: postId, author_id: userId, content })
      .select("id, post_id, author_id, content, created_at")
      .single();

    if (error) {
      console.error("[community/comments POST]", error);
      return NextResponse.json({ error: "Failed to post comment" }, { status: 500 });
    }

    return NextResponse.json({ data: { ...data, author: null } });
  } catch (err) {
    console.error("[community/comments POST]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
