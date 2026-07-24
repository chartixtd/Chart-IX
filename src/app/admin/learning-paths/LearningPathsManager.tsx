"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { LearningPath, LearningPathStep, Video } from "@/types";

type SlimVideo = Pick<Video, "id" | "title" | "duration_seconds" | "tier_required" | "is_deleted">;

interface LearningPathsManagerProps {
  paths: LearningPath[];
  steps: LearningPathStep[];
  videos: SlimVideo[];
}

const LOCALES = [
  { key: "zh-CN", label: "中文" },
  { key: "en-US", label: "English" },
  { key: "ms-MY", label: "Bahasa" },
] as const;

const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const LEVEL_LABELS: Record<string, string> = {
  beginner: "新手",
  intermediate: "进阶",
  advanced: "高级",
};

function getVideoTitle(v: SlimVideo | undefined): string {
  if (!v) return "(已删除的视频)";
  return v.title?.["zh-CN"] ?? v.title?.["en-US"] ?? v.title?.["ms-MY"] ?? "无标题";
}

interface FormState {
  id: number | null;
  slug: string;
  titleZh: string;
  titleEn: string;
  titleMs: string;
  descZh: string;
  descEn: string;
  descMs: string;
  coverImage: string;
  level: (typeof LEVELS)[number];
  isPublished: boolean;
  videoIds: string[];
}

const EMPTY_FORM: FormState = {
  id: null,
  slug: "",
  titleZh: "",
  titleEn: "",
  titleMs: "",
  descZh: "",
  descEn: "",
  descMs: "",
  coverImage: "",
  level: "beginner",
  isPublished: false,
  videoIds: [],
};

export function LearningPathsManager({ paths, steps, videos }: LearningPathsManagerProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pendingVideoId, setPendingVideoId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const stepsByPath = useMemo(() => {
    const map = new Map<number, LearningPathStep[]>();
    for (const s of steps) {
      const list = map.get(s.path_id) ?? [];
      list.push(s);
      map.set(s.path_id, list);
    }
    return map;
  }, [steps]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setPendingVideoId("");
    setModalOpen(true);
  };

  const openEdit = (path: LearningPath) => {
    const pathSteps = (stepsByPath.get(path.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    setForm({
      id: path.id,
      slug: path.slug,
      titleZh: path.title["zh-CN"] ?? "",
      titleEn: path.title["en-US"] ?? "",
      titleMs: path.title["ms-MY"] ?? "",
      descZh: path.description?.["zh-CN"] ?? "",
      descEn: path.description?.["en-US"] ?? "",
      descMs: path.description?.["ms-MY"] ?? "",
      coverImage: path.cover_image ?? "",
      level: path.level,
      isPublished: path.is_published,
      videoIds: pathSteps.map((s) => s.video_id),
    });
    setPendingVideoId("");
    setModalOpen(true);
  };

  const addStep = () => {
    if (!pendingVideoId || form.videoIds.includes(pendingVideoId)) return;
    setForm((f) => ({ ...f, videoIds: [...f.videoIds, pendingVideoId] }));
    setPendingVideoId("");
  };

  const removeStep = (videoId: string) => {
    setForm((f) => ({ ...f, videoIds: f.videoIds.filter((id) => id !== videoId) }));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setForm((f) => {
      const next = [...f.videoIds];
      const target = index + dir;
      if (target < 0 || target >= next.length) return f;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...f, videoIds: next };
    });
  };

  const handleSave = async () => {
    const title: Record<string, string> = {};
    if (form.titleZh.trim()) title["zh-CN"] = form.titleZh.trim();
    if (form.titleEn.trim()) title["en-US"] = form.titleEn.trim();
    if (form.titleMs.trim()) title["ms-MY"] = form.titleMs.trim();

    if (!form.slug.trim() || Object.keys(title).length === 0) {
      toast("请填写 slug 和至少一个标题", "error");
      return;
    }

    const description: Record<string, string> = {};
    if (form.descZh.trim()) description["zh-CN"] = form.descZh.trim();
    if (form.descEn.trim()) description["en-US"] = form.descEn.trim();
    if (form.descMs.trim()) description["ms-MY"] = form.descMs.trim();

    const payload = {
      slug: form.slug.trim(),
      title,
      description: Object.keys(description).length > 0 ? description : null,
      cover_image: form.coverImage.trim() || null,
      level: form.level,
      is_published: form.isPublished,
      video_ids: form.videoIds,
    };

    setSaving(true);
    try {
      const res = await fetch("/api/admin/learning-paths", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "保存失败");

      toast(form.id ? "学习路径已更新" : "学习路径已创建", "success");
      setModalOpen(false);
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
      const res = await fetch("/api/admin/learning-paths", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirmDelete.id }),
      });
      if (res.ok) {
        toast("学习路径已删除", "success");
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

  const togglePublish = async (path: LearningPath) => {
    try {
      const res = await fetch("/api/admin/learning-paths", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: path.id, is_published: !path.is_published }),
      });
      if (res.ok) router.refresh();
    } catch { /* ignore */ }
  };

  const availableVideos = videos.filter((v) => !form.videoIds.includes(v.id));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-secondary">共 {paths.length} 条学习路径</p>
        <Button variant="primary" size="sm" onClick={openCreate}>+ 新建学习路径</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">标题</th>
              <th className="px-4 py-3 text-text-muted">等级</th>
              <th className="px-4 py-3 text-text-muted">课程数</th>
              <th className="px-4 py-3 text-text-muted">状态</th>
              <th className="px-4 py-3 text-text-muted">操作</th>
            </tr>
          </thead>
          <tbody>
            {paths.map((p) => (
              <tr key={p.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td className="px-4 py-3 text-text-primary">
                  {p.title["zh-CN"] ?? p.title["en-US"]}
                  <span className="ml-2 text-xs text-text-muted">/{p.slug}</span>
                </td>
                <td className="px-4 py-3 text-text-secondary">{LEVEL_LABELS[p.level]}</td>
                <td className="px-4 py-3 text-text-secondary">{(stepsByPath.get(p.id) ?? []).length}</td>
                <td className="px-4 py-3">
                  <button onClick={() => togglePublish(p)}>
                    <Badge variant={p.is_published ? "green" : "gray"}>
                      {p.is_published ? "已发布" : "草稿"}
                    </Badge>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>编辑</Button>
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setConfirmDelete({ id: p.id })}>
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paths.length === 0 && <p className="mt-4 text-center text-text-muted">还没有学习路径</p>}

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="删除学习路径"
        message="确定要删除此学习路径吗？此操作不可撤销（不会删除视频本身）。"
        confirmText="删除"
        cancelText="取消"
        loading={deleting}
        variant="danger"
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "编辑学习路径" : "新建学习路径"} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Slug" placeholder="beginner-basics" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">等级</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value as FormState["level"] }))}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">标题（至少填写一个）</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {LOCALES.map(({ key, label }) => (
                <Input
                  key={key}
                  label={label}
                  value={key === "zh-CN" ? form.titleZh : key === "en-US" ? form.titleEn : form.titleMs}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => key === "zh-CN" ? { ...f, titleZh: v } : key === "en-US" ? { ...f, titleEn: v } : { ...f, titleMs: v });
                  }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">简介（可选）</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {LOCALES.map(({ key, label }) => (
                <Input
                  key={key}
                  label={label}
                  value={key === "zh-CN" ? form.descZh : key === "en-US" ? form.descEn : form.descMs}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => key === "zh-CN" ? { ...f, descZh: v } : key === "en-US" ? { ...f, descEn: v } : { ...f, descMs: v });
                  }}
                />
              ))}
            </div>
          </div>

          <Input label="封面图片 URL（可选）" placeholder="https://..." value={form.coverImage} onChange={(e) => setForm((f) => ({ ...f, coverImage: e.target.value }))} />

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm((f) => ({ ...f, isPublished: e.target.checked }))} />
            发布（用户可见）
          </label>

          {/* Steps builder */}
          <div className="space-y-2 rounded-sm border border-border-default p-3">
            <p className="text-sm font-medium text-text-secondary">课程步骤（按顺序 = 前置关系）</p>
            {form.videoIds.length === 0 && <p className="text-xs text-text-muted">还没有添加课程</p>}
            <div className="space-y-1">
              {form.videoIds.map((vid, i) => (
                <div key={vid} className="flex items-center justify-between rounded-xs bg-bg-tertiary px-2 py-1.5 text-xs">
                  <span className="text-text-primary">{i + 1}. {getVideoTitle(videoById.get(vid))}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30">↑</button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === form.videoIds.length - 1} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30">↓</button>
                    <button onClick={() => removeStep(vid)} className="px-1 text-red-400 hover:text-red-300">移除</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <select
                value={pendingVideoId}
                onChange={(e) => setPendingVideoId(e.target.value)}
                className="flex-1 rounded-sm border border-border-default bg-bg-tertiary px-2 py-1.5 text-xs text-text-primary"
              >
                <option value="">选择要添加的视频…</option>
                {availableVideos.map((v) => (
                  <option key={v.id} value={v.id}>{getVideoTitle(v)}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={addStep} disabled={!pendingVideoId}>添加</Button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>取消</Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>保存</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
