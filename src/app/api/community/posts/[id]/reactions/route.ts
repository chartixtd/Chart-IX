import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTier } from "@/lib/supabase/get-user-tier";

const ALLOWED_EMOJI = new Set(["👍", "❤️", "🚀", "🔥", "😂"]);

// POST: 切换 react —— 已经 react 过同一个表情就取消，没有就加上。
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: postId } = await params;
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const emoji = typeof body.emoji === "string" ? body.emoji : "";
    if (!ALLOWED_EMOJI.has(emoji)) {
      return NextResponse.json({ error: "Unsupported emoji" }, { status: 400 });
    }

    const tier = await getUserTier(userId);
    if (tier !== "pro") {
      return NextResponse.json({ error: "pro_required" }, { status: 403 });
    }

    const { data: existing } = await supabase
      .from("community_reactions")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .eq("emoji", emoji)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("community_reactions").delete().eq("id", existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data: { emoji, active: false } });
    }

    const { error } = await supabase
      .from("community_reactions")
      .insert({ post_id: postId, user_id: userId, emoji });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: { emoji, active: true } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
