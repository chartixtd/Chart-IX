import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getUserTier } from "@/lib/supabase/get-user-tier";
import type { CommunityAuthor, CommunityPost } from "@/types";

const PAGE_SIZE = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10_000;

// GET: 分页拉取社区帖子 feed，附带作者信息（安全字段）、评论数、react 汇总、
// 当前登录用户自己的 react 状态。author 的 display_name/avatar_url 必须用
// service-role 查——public.users 的 RLS 只放行 auth.uid() = id 这一条，
// 客户端 join 查不到别人的资料。
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);

    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const viewerId = authData.user?.id ?? null;

    const serviceClient = createServiceRoleClient();

    const { data: posts, error } = await serviceClient
      .from("community_posts")
      .select("id, author_id, title, content, created_at, updated_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!posts || posts.length === 0) {
      return NextResponse.json({ data: [], hasMore: false });
    }

    const postIds = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.author_id))];

    const [{ data: authors }, { data: reactions }, { data: comments }] = await Promise.all([
      serviceClient.from("users").select("id, display_name, avatar_url").in("id", authorIds),
      serviceClient.from("community_reactions").select("post_id, user_id, emoji").in("post_id", postIds),
      serviceClient.from("community_comments").select("post_id").in("post_id", postIds),
    ]);

    const authorById = new Map<string, CommunityAuthor>((authors ?? []).map((a) => [a.id, a]));

    const commentCountByPost = new Map<string, number>();
    for (const c of comments ?? []) {
      commentCountByPost.set(c.post_id, (commentCountByPost.get(c.post_id) ?? 0) + 1);
    }

    const reactionCountsByPost = new Map<string, Record<string, number>>();
    const viewerReactionsByPost = new Map<string, string[]>();
    for (const r of reactions ?? []) {
      const counts = reactionCountsByPost.get(r.post_id) ?? {};
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
      reactionCountsByPost.set(r.post_id, counts);

      if (viewerId && r.user_id === viewerId) {
        const mine = viewerReactionsByPost.get(r.post_id) ?? [];
        mine.push(r.emoji);
        viewerReactionsByPost.set(r.post_id, mine);
      }
    }

    const data: CommunityPost[] = posts.map((p) => ({
      id: p.id,
      author_id: p.author_id,
      author: authorById.get(p.author_id) ?? null,
      title: p.title,
      content: p.content,
      created_at: p.created_at,
      updated_at: p.updated_at,
      comment_count: commentCountByPost.get(p.id) ?? 0,
      reaction_counts: reactionCountsByPost.get(p.id) ?? {},
      viewer_reactions: viewerReactionsByPost.get(p.id) ?? [],
    }));

    return NextResponse.json({ data, hasMore: posts.length === PAGE_SIZE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST: 发帖，仅 Pro 用户
export async function POST(request: NextRequest) {
  try {
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
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";

    if (!title || !content) {
      return NextResponse.json({ error: "title and content are required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH || content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: "title or content too long" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("community_posts")
      .insert({ author_id: userId, title, content })
      .select("id, author_id, title, content, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const post: CommunityPost = {
      ...data,
      author: null,
      comment_count: 0,
      reaction_counts: {},
      viewer_reactions: [],
    };

    return NextResponse.json({ data: post });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
