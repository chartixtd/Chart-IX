"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { Quiz, QuizQuestion, Locale } from "@/types";
import { Icon } from "@/components/ui/Icon";

export function VideoQuiz({ videoId }: { videoId: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("quiz");
  const auth = useAuth();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; passed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: quizData } = await supabase.from("quizzes").select("*").eq("video_id", videoId).maybeSingle();
      if (!quizData) return;
      const { data: questionData } = await supabase
        .from("quiz_questions")
        .select("*")
        .eq("quiz_id", quizData.id)
        .order("sort_order", { ascending: true });
      if (!cancelled) {
        setQuiz(quizData as Quiz);
        setQuestions((questionData ?? []) as QuizQuestion[]);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [videoId]);

  if (!quiz || questions.length === 0) return null;

  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  const handleSubmit = async () => {
    if (!allAnswered) return;
    setSubmitting(true);

    let score = 0;
    for (const q of questions) {
      if (answers[q.id] === q.correct_index) score++;
    }
    const total = questions.length;
    const passed = score / total >= 0.6;

    if (auth.userId) {
      const supabase = createClient();
      await supabase.from("quiz_attempts").insert({
        user_id: auth.userId,
        quiz_id: quiz.id,
        score,
        total,
        passed,
      });
      if (passed) {
        await supabase.rpc("grant_achievement", { p_key: "first_quiz_passed" });
      }
    }

    setResult({ score, total, passed });
    setSubmitted(true);
    setSubmitting(false);
  };

  const handleRetry = () => {
    setAnswers({});
    setSubmitted(false);
    setResult(null);
  };

  return (
    <Card className="mt-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-text-primary">
        <Icon name="quiz" className="h-5 w-5 shrink-0 text-gold" />
        {quiz.title[locale] ?? quiz.title["zh-CN"]}
      </h2>

      {submitted && result ? (
        <div className="mt-4">
          <p className={cn("text-2xl font-bold", result.passed ? "text-success" : "text-danger")}>
            {result.score} / {result.total}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {result.passed ? t("passed") : t("failed")}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={handleRetry}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {questions.map((q, qi) => {
            const questionText = q.question[locale] ?? q.question["zh-CN"];
            const options = q.options[locale] ?? q.options["zh-CN"] ?? [];
            return (
              <div key={q.id}>
                <p className="text-sm font-medium text-text-primary">{qi + 1}. {questionText}</p>
                <div className="mt-2 space-y-1.5">
                  {options.map((opt, oi) => (
                    <label
                      key={oi}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-xs border px-3 py-2 text-sm transition-colors",
                        answers[q.id] === oi
                          ? "border-gold bg-gold/10 text-text-primary"
                          : "border-border-default text-text-secondary hover:border-border-hover"
                      )}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={answers[q.id] === oi}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        className="shrink-0"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <Button variant="primary" size="sm" disabled={!allAnswered} loading={submitting} onClick={handleSubmit}>
            {t("submit")}
          </Button>
        </div>
      )}
    </Card>
  );
}
