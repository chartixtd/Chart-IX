"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Quiz, QuizQuestion, Video } from "@/types";
import { Icon } from "@/components/ui/Icon";

type SlimVideo = Pick<Video, "id" | "title" | "is_deleted">;

interface QuizzesManagerProps {
  videos: SlimVideo[];
  quizzes: Quiz[];
  questions: QuizQuestion[];
}

interface QuestionDraft {
  text: string;
  options: string[];
  correctIndex: number;
}

function getVideoTitle(v: SlimVideo | undefined): string {
  if (!v) return "(未知视频)";
  return v.title?.["zh-CN"] ?? v.title?.["en-US"] ?? v.title?.["ms-MY"] ?? "无标题";
}

const emptyQuestion = (): QuestionDraft => ({ text: "", options: ["", ""], correctIndex: 0 });

export function QuizzesManager({ videos, quizzes, questions }: QuizzesManagerProps) {
  const router = useRouter();
  const { toast } = useToast();

  const quizByVideo = useMemo(() => new Map(quizzes.map((q) => [q.video_id, q])), [quizzes]);
  const questionsByQuiz = useMemo(() => {
    const map = new Map<number, QuizQuestion[]>();
    for (const q of questions) {
      const list = map.get(q.quiz_id) ?? [];
      list.push(q);
      map.set(q.quiz_id, list);
    }
    return map;
  }, [questions]);

  const [modalVideo, setModalVideo] = useState<SlimVideo | null>(null);
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ quizId: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openFor = (video: SlimVideo) => {
    const quiz = quizByVideo.get(video.id);
    if (quiz) {
      const qs = (questionsByQuiz.get(quiz.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      setTitle(quiz.title["zh-CN"] ?? "");
      setDrafts(qs.map((q) => ({
        text: q.question["zh-CN"] ?? "",
        options: q.options["zh-CN"] ?? ["", ""],
        correctIndex: q.correct_index,
      })));
    } else {
      setTitle("");
      setDrafts([emptyQuestion()]);
    }
    setModalVideo(video);
  };

  const addQuestion = () => setDrafts((d) => [...d, emptyQuestion()]);
  const removeQuestion = (i: number) => setDrafts((d) => d.filter((_, idx) => idx !== i));
  const updateQuestionText = (i: number, text: string) =>
    setDrafts((d) => d.map((q, idx) => (idx === i ? { ...q, text } : q)));
  const addOption = (i: number) =>
    setDrafts((d) => d.map((q, idx) => (idx === i ? { ...q, options: [...q.options, ""] } : q)));
  const removeOption = (i: number, oi: number) =>
    setDrafts((d) => d.map((q, idx) => {
      if (idx !== i) return q;
      const options = q.options.filter((_, k) => k !== oi);
      const correctIndex = q.correctIndex >= options.length ? 0 : q.correctIndex;
      return { ...q, options, correctIndex };
    }));
  const updateOption = (i: number, oi: number, value: string) =>
    setDrafts((d) => d.map((q, idx) => {
      if (idx !== i) return q;
      const options = [...q.options];
      options[oi] = value;
      return { ...q, options };
    }));
  const setCorrect = (i: number, oi: number) =>
    setDrafts((d) => d.map((q, idx) => (idx === i ? { ...q, correctIndex: oi } : q)));

  const handleSave = async () => {
    if (!modalVideo) return;
    if (!title.trim()) { toast("请填写小测标题", "error"); return; }
    if (drafts.length === 0) { toast("至少需要一道题目", "error"); return; }
    for (const q of drafts) {
      if (!q.text.trim() || q.options.filter((o) => o.trim()).length < 2) {
        toast("每道题目需要题干和至少两个选项", "error");
        return;
      }
    }

    const existingQuiz = quizByVideo.get(modalVideo.id);
    const payload = {
      title: { "zh-CN": title.trim() },
      questions: drafts.map((q) => ({
        question: { "zh-CN": q.text.trim() },
        options: { "zh-CN": q.options.map((o) => o.trim()) },
        correct_index: q.correctIndex,
      })),
    };

    setSaving(true);
    try {
      const res = existingQuiz
        ? await fetch("/api/admin/quizzes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existingQuiz.id, ...payload }),
          })
        : await fetch("/api/admin/quizzes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: modalVideo.id, ...payload }),
          });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "保存失败");

      toast("小测已保存", "success");
      setModalVideo(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/quizzes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirmDelete.quizId }),
      });
      if (res.ok) {
        toast("小测已删除", "success");
        router.refresh();
      } else {
        toast("删除失败", "error");
      }
    } catch {
      toast("删除失败", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">视频</th>
              <th className="px-4 py-3 text-text-muted">小测</th>
              <th className="px-4 py-3 text-text-muted">题目数</th>
              <th className="px-4 py-3 text-text-muted">操作</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => {
              const quiz = quizByVideo.get(v.id);
              return (
                <tr key={v.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                  <td className="px-4 py-3 text-text-primary">{getVideoTitle(v)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={quiz ? "green" : "gray"}>{quiz ? "已创建" : "无"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {quiz ? (questionsByQuiz.get(quiz.id) ?? []).length : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openFor(v)}>
                        {quiz ? "编辑" : "创建小测"}
                      </Button>
                      {quiz && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmDelete({ quizId: quiz.id })}>
                          删除
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {videos.length === 0 && (
        <p className="mt-4 text-center text-text-muted">
          还没有视频，请先去&ldquo;视频管理&rdquo;上传视频，再回来给视频挂小测。
        </p>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="删除小测"
        message="确定要删除此小测吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        loading={deleting}
        variant="danger"
      />

      <Modal open={modalVideo !== null} onClose={() => setModalVideo(null)} title={`小测 · ${modalVideo ? getVideoTitle(modalVideo) : ""}`} size="lg">
        <div className="space-y-4">
          <Input label="小测标题" placeholder="例如：本课小测" value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className="space-y-4">
            {drafts.map((q, i) => (
              <div key={i} className="space-y-2 rounded-sm border border-border-default p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">题目 {i + 1}</span>
                  <button onClick={() => removeQuestion(i)} className="text-xs text-danger hover:text-danger">删除题目</button>
                </div>
                <Input placeholder="题干" value={q.text} onChange={(e) => updateQuestionText(i, e.target.value)} />
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={q.correctIndex === oi}
                        onChange={() => setCorrect(i, oi)}
                        title="标记为正确答案"
                      />
                      <Input
                        placeholder={`选项 ${oi + 1}`}
                        value={opt}
                        onChange={(e) => updateOption(i, oi, e.target.value)}
                        className="flex-1"
                      />
                      {q.options.length > 2 && (
                        <button onClick={() => removeOption(i, oi)} className="text-xs text-danger hover:text-danger" aria-label="删除选项"><Icon name="x" className="h-3.5 w-3.5" strokeWidth={2.2} /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => addOption(i)} className="text-xs text-gold hover:underline">+ 添加选项</button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={addQuestion}>+ 添加题目</Button>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalVideo(null)}>取消</Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>保存</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
