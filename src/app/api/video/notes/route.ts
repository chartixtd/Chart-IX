import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET: 获取当前用户对指定视频的所有笔记
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("video_id");
    if (!videoId) {
      return NextResponse.json({ error: "video_id is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("video_notes")
      .select("*")
      .eq("user_id", userId)
      .eq("video_id", videoId)
      .order("timestamp_seconds", { ascending: true });

    if (error) {
      console.error("[video/notes GET]", error);
      return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[video/notes GET]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

// POST: 创建笔记
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { video_id, content, timestamp_seconds } = body;

    if (!video_id || !content) {
      return NextResponse.json({ error: "video_id and content are required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("video_notes")
      .insert({
        user_id: userId,
        video_id,
        content,
        timestamp_seconds: timestamp_seconds ?? 0,
      })
      .select()
      .single();

    if (error) {
      console.error("[video/notes POST]", error);
      return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[video/notes POST]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

// PUT: 更新笔记
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, content } = body;

    if (!id || !content) {
      return NextResponse.json({ error: "id and content are required" }, { status: 400 });
    }

    // 验证笔记归属
    const { data: existing } = await supabase
      .from("video_notes")
      .select("user_id")
      .eq("id", id)
      .single();

    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: "Not found or not authorized" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("video_notes")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[video/notes PUT]", error);
      return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[video/notes PUT]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

// DELETE: 删除笔记
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // 验证笔记归属
    const { data: existing } = await supabase
      .from("video_notes")
      .select("user_id")
      .eq("id", id)
      .single();

    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: "Not found or not authorized" }, { status: 404 });
    }

    const { error } = await supabase.from("video_notes").delete().eq("id", id);

    if (error) {
      console.error("[video/notes DELETE]", error);
      return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[video/notes DELETE]", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
