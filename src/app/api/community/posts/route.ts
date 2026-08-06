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
      .select("id, author_id, title, content, cover_image, created_at, updated_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[community/posts GET]", error);
      return NextResponse.json({ error: "Failed to load posts" }, { status: 500 });
    }
    if (!posts || posts.length === 0) {
      return NextResponse.json({ data: [], hasMore: false });
    }

    const postIds = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.author_id))];

    // 评论数与按表情分组的反应数由 033 迁移的 RPC 在 SQL 侧用 GROUP BY 聚合，
    // 不再把整页帖子的评论/反应行整表拉回 Node 用 for 循环累加。
    // viewer 自己的反应仍需要行级数据（具体是哪个表情），但只查这一个用户的，
    // 行数远小于"这页所有帖子的全部反应"。
    const [{ data: authors }, { data: stats }, { data: viewerReactions }] = await Promise.all([
      serviceClient.from("users").select("id, display_name, avatar_url").in("id", authorIds),
      serviceClient.rpc("get_community_post_stats", { p_post_ids: postIds }),
      viewerId
        ? serviceClient.from("community_reactions").select("post_id, emoji").eq("user_id", viewerId).in("post_id", postIds)
        : Promise.resolve({ data: [] as { post_id: string; emoji: string }[] }),
    ]);

    const authorById = new Map<string, CommunityAuthor>((authors ?? []).map((a) => [a.id, a]));

    type PostStatsRow = { post_id: string; comment_count: number; reaction_counts: Record<string, number> };
    const statsByPost = new Map<string, { comment_count: number; reaction_counts: Record<string, number> }>(
      ((stats ?? []) as PostStatsRow[]).map((s) => [
        s.post_id,
        { comment_count: Number(s.comment_count), reaction_counts: s.reaction_counts ?? {} },
      ])
    );

    const viewerReactionsByPost = new Map<string, string[]>();
    for (const r of viewerReactions ?? []) {
      const mine = viewerReactionsByPost.get(r.post_id) ?? [];
      mine.push(r.emoji);
      viewerReactionsByPost.set(r.post_id, mine);
    }

    const data: CommunityPost[] = posts.map((p) => ({
      id: p.id,
      author_id: p.author_id,
      author: authorById.get(p.author_id) ?? null,
      title: p.title,
      content: p.content,
      cover_image: p.cover_image,
      created_at: p.created_at,
      updated_at: p.updated_at,
      comment_count: statsByPost.get(p.id)?.comment_count ?? 0,
      reaction_counts: statsByPost.get(p.id)?.reaction_counts ?? {},
      viewer_reactions: viewerReactionsByPost.get(p.id) ?? [],
    }));

    return NextResponse.json({ data, hasMore: posts.length === PAGE_SIZE });
  } catch (err) {
    console.error("[community/posts GET]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
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

    const { data, error } = await supabase
      .from("community_posts")
      .insert({ author_id: userId, title, content, cover_image: coverImage })
      .select("id, author_id, title, content, cover_image, created_at, updated_at")
      .single();

    if (error) {
      console.error("[community/posts POST]", error);
      return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
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
    console.error("[community/posts POST]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
