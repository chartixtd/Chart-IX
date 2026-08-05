import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10_000;

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

    if (!title || !content) {
      return NextResponse.json({ error: "title and content are required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH || content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: "title or content too long" }, { status: 400 });
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
      .update({ title, content })
      .eq("id", id)
      .select("id, author_id, title, content, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
