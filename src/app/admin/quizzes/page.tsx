import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { QuizzesManager } from "./QuizzesManager";
import type { Quiz, QuizQuestion, Video } from "@/types";

export const dynamic = "force-dynamic";

type SlimVideo = Pick<Video, "id" | "title" | "is_deleted">;

export default async function AdminQuizzesPage() {
  const client = createServiceRoleClient();

  const [videosRes, quizzesRes, questionsRes] = await Promise.all([
    client.from("videos").select("id, title, is_deleted").eq("is_deleted", false).order("title", { ascending: true }),
    client.from("quizzes").select("*"),
    client.from("quiz_questions").select("*").order("sort_order", { ascending: true }),
  ]);

  const videos = (videosRes.data ?? []) as SlimVideo[];
  const quizzes = (quizzesRes.data ?? []) as Quiz[];
  const questions = (questionsRes.data ?? []) as QuizQuestion[];
  const error = videosRes.error?.message ?? quizzesRes.error?.message ?? questionsRes.error?.message ?? null;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary font-display tracking-tight">随堂小测管理</h1>
      {error ? (
        <div className="text-danger">Failed to load quizzes. Please try again later.</div>
      ) : (
        <QuizzesManager videos={videos} quizzes={quizzes} questions={questions} />
      )}
    </div>
  );
}
