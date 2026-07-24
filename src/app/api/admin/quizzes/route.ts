import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { logAdminAction } from "@/lib/supabase/admin-log";

interface QuestionInput {
  question: Record<string, string>;
  options: Record<string, string[]>;
  correct_index: number;
}

async function replaceQuestions(
  client: ReturnType<typeof createServiceRoleClient>,
  quizId: number,
  questions: QuestionInput[]
) {
  await client.from("quiz_questions").delete().eq("quiz_id", quizId);
  if (questions.length === 0) return null;

  const rows = questions.map((q, index) => ({
    quiz_id: quizId,
    question: q.question,
    options: q.options,
    correct_index: q.correct_index,
    sort_order: index,
  }));
  const { error } = await client.from("quiz_questions").insert(rows);
  return error;
}

// POST - Create a quiz (with questions) for a video
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const { video_id, title, questions } = body as {
      video_id?: string;
      title?: Record<string, string>;
      questions?: QuestionInput[];
    };

    if (!video_id) return NextResponse.json({ error: "video_id is required" }, { status: 400 });
    if (!title || Object.keys(title).length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("quizzes")
      .insert({ video_id, title })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "This video already has a quiz" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (Array.isArray(questions) && questions.length > 0) {
      const qError = await replaceQuestions(client, data.id, questions);
      if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });
    }

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "create_quiz",
        targetType: "quiz",
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

// PATCH - Update a quiz's title and/or replace its questions
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id, title, questions } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const client = createServiceRoleClient();

    if (title) {
      const { error } = await client.from("quizzes").update({ title }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (Array.isArray(questions)) {
      const qError = await replaceQuestions(client, id, questions);
      if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });
    }

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "update_quiz",
        targetType: "quiz",
        targetId: String(id),
        oldValue: null,
        newValue: { title, questions },
      });
    } catch { /* logging failure should never break the response */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

// DELETE - Delete a quiz (questions cascade via FK)
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const client = createServiceRoleClient();
    const { error } = await client.from("quizzes").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "delete_quiz",
        targetType: "quiz",
        targetId: String(id),
        oldValue: null,
        newValue: null,
      });
    } catch { /* logging failure should never break the response */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
