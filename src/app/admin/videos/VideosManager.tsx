"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { LANGUAGE_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Video, VideoCategory } from "@/types";
import { needsCompression, compressVideo, COMPRESSION_THRESHOLD_BYTES } from "@/lib/video-compress";

interface VideosManagerProps {
  videos: Video[];
  categories: VideoCategory[];
  isLoading?: boolean;
}

const PAGE_SIZE = 20;

export function VideosManager({ videos, categories, isLoading = false }: VideosManagerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("admin");
  const tc = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();

  // Search & pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<"compressing" | "uploading">("uploading");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [sizeWarning, setSizeWarning] = useState("");

  // Confirm dialog state
  const [confirmDelete, setConfirmDelete] = useState<{ id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Upload / edit form fields
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<string>("en-US");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [duration, setDuration] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tier, setTier] = useState("free");

  // 编辑模式：非 null 表示正在编辑该视频（此时无需重新上传视频文件）
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setVideoFile(null);
    setLanguage("en-US");
    setTitle("");
    setDescription("");
    setThumbnailUrl("");
    setDuration("");
    setCategoryId("");
    setTier("free");
    setUploadError("");
    setUploadProgress(0);
    setUploadPhase("uploading");
    setSizeWarning("");
    setEditingVideo(null);
  };

  const closeModal = () => {
    // Never allow the modal to dismiss while an upload/compression job is
    // in flight — closing it would orphan the running handleUpload() call,
    // which keeps compressing/uploading in the background and can collide
    // with a second job started from a freshly reopened modal.
    if (uploading) return;
    setShowUpload(false);
    resetForm();
  };

  /** 打开编辑弹窗，用视频当前数据预填表单 */
  const openEdit = (v: Video) => {
    const lang = v.language ?? "en-US";
    setEditingVideo(v);
    setLanguage(lang);
    setTitle(v.title?.[lang as keyof typeof v.title] ?? v.title?.["en-US"] ?? "");
    setDescription(v.description?.[lang as keyof typeof v.description] ?? v.description?.["en-US"] ?? "");
    setThumbnailUrl(v.thumbnail_url ?? "");
    setDuration(v.duration_seconds ? String(v.duration_seconds) : "");
    setCategoryId(v.category_id ? String(v.category_id) : "");
    setTier(v.tier_required);
    setVideoFile(null);
    setUploadError("");
    setUploadProgress(0);
    setShowUpload(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setUploadError("");
    }
  };

  /** 从设备上传缩略图图片 */
  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbnailUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("videos_list.thumbnail_upload_failed"));
      setThumbnailUrl(data.url);
      toast(t("videos_list.thumbnail_uploaded"), "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : t("videos_list.thumbnail_upload_failed"), "error");
    } finally {
      setThumbnailUploading(false);
      if (thumbInputRef.current) thumbInputRef.current.value = "";
    }
  };

  /** 保存对已上传视频的编辑 */
  const handleSaveEdit = async () => {
    if (!editingVideo) return;
    if (!title.trim()) {
      setUploadError(t("videos_list.title_required_error"));
      return;
    }
    setSaving(true);
    setUploadError("");
    try {
      // 只保留当前所选语言的标题/描述，保持单语言模型
      const ok = await updateVideo(editingVideo.id, {
        language,
        title: { [language]: title.trim() },
        description: description.trim() ? { [language]: description.trim() } : null,
        category_id: categoryId ? parseInt(categoryId) : null,
        thumbnail_url: thumbnailUrl.trim() || null,
        duration_seconds: duration ? parseInt(duration) : 0,
        tier_required: tier,
      });
      if (!ok) throw new Error(t("videos_list.save_failed"));
      toast(t("videos_list.saved"), "success");
      closeModal();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("videos_list.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async () => {
    if (!videoFile) {
      setUploadError(t("videos_list.please_select_file"));
      return;
    }
    if (!title.trim()) {
      setUploadError(t("videos_list.title_required_error"));
      return;
    }

    setUploading(true);
    setUploadError("");
    setSizeWarning("");
    setUploadPhase("uploading");
    setUploadProgress(10);

    try {
      let fileToUpload = videoFile;

      if (needsCompression(videoFile.size)) {
        setUploadPhase("compressing");
        setUploadProgress(0);
        try {
          fileToUpload = await compressVideo(videoFile, (pct) => setUploadProgress(pct));
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : t("videos_list.upload_failed"));
          setUploading(false);
          return;
        }
        if (fileToUpload.size > COMPRESSION_THRESHOLD_BYTES) {
          setSizeWarning(t("videos_list.still_over_limit_warning", { size: (fileToUpload.size / (1024 * 1024)).toFixed(1) }));
        }
      }

      setUploadPhase("uploading");
      setUploadProgress(10);

      const supabase = createClient();

      // Generate unique filename
      const fileExt = fileToUpload.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      // Get signed upload URL to bypass Supabase API gateway size limits
      const mimeType = fileToUpload.type || "video/mp4";
      const { data: signedData, error: signedErr } = await supabase.storage
        .from("videos")
        .createSignedUploadUrl(fileName, { upsert: false });

      if (signedErr || !signedData?.signedUrl) {
        setUploadError(`${t("videos_list.upload_failed")}: ${signedErr?.message ?? "Unknown error"}`);
        setUploading(false);
        return;
      }

      setUploadProgress(20);

      // Upload via signed URL (direct to storage, bypasses gateway)
      const uploadResponse = await fetch(signedData.signedUrl, {
        method: "PUT",
        body: fileToUpload,
        headers: { "Content-Type": mimeType },
      });

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        console.error("Signed URL upload failed:", uploadResponse.status, errText);
        setUploadError(`${t("videos_list.upload_failed")}: ${errText || uploadResponse.statusText}`);
        setUploading(false);
        return;
      }

      setUploadProgress(80);

      // Get public URL
      const { data: urlData } = supabase.storage.from("videos").getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      // Send metadata to API to create video record
      const titleObj: Record<string, string> = { [language]: title.trim() };
      const descObj: Record<string, string> | null = description.trim()
        ? { [language]: description.trim() }
        : null;

      const res = await fetch("/api/admin/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleObj,
          description: descObj,
          category_id: categoryId ? parseInt(categoryId) : null,
          storage_url: publicUrl,
          thumbnail_url: thumbnailUrl.trim() || null,
          duration_seconds: duration ? parseInt(duration) : 0,
          file_size_bytes: fileToUpload.size,
          tier_required: tier,
          language,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? t("videos_list.upload_failed"));
      }

      setUploadProgress(100);
      toast(t("videos_list.upload_success"), "success");
      resetForm();
      setShowUpload(false);
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("videos_list.upload_failed"));
    } finally {
      setUploading(false);
    }
  };

  const updateVideo = async (id: string, updates: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
      if (res.ok) {
        router.refresh();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleHardDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/videos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirmDelete.id }),
      });
      if (res.ok) {
        toast(t("videos_list.hard_deleted"), "success");
        router.refresh();
      } else {
        toast(t("videos_list.upload_failed"), "error");
      }
    } catch {
      toast(t("videos_list.upload_failed"), "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const getTitle = (video: Video): string => {
    return video.title?.[locale as keyof typeof video.title] ?? video.title?.["en-US"] ?? video.title?.["zh-CN"] ?? video.title?.["ms-MY"] ?? t("videos_list.untitled");
  };

  const getCategoryName = (cat: VideoCategory | undefined): string => {
    if (!cat) return "-";
    return cat.name?.[locale as keyof typeof cat.name] ?? cat.name?.["en-US"] ?? cat.name?.["zh-CN"] ?? cat.name?.["ms-MY"] ?? cat.slug;
  };

  // Filter videos by search query (case-insensitive across all title locales)
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter((v) => {
      const titles = [v.title?.["en-US"], v.title?.["zh-CN"], v.title?.["ms-MY"]];
      return titles.some((t) => t?.toLowerCase().includes(q));
    });
  }, [videos, searchQuery]);

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-32 animate-pulse rounded bg-bg-tertiary" />
          <div className="h-9 w-28 animate-pulse rounded bg-bg-tertiary" />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <div className="animate-pulse space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-bg-tertiary" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Top bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-secondary">{t("videos_list.videos_total", { count: filtered.length })}</p>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t("videos_list.search_placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56"
          />
          <Button variant="primary" size="sm" onClick={() => setShowUpload(true)}>
            {t("videos_list.add_video")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.title_col")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.language")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.category")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.duration")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.tier")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.views")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.status")}</th>
              <th className="px-4 py-3 text-text-muted">{t("videos_list.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((v) => (
              <tr key={v.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td className="max-w-[240px] truncate px-4 py-3 text-text-primary" title={getTitle(v)}>
                  {getTitle(v)}
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs">{LANGUAGE_LABELS[v.language] ?? v.language ?? "-"}</td>
                <td className="px-4 py-3 text-text-secondary">{getCategoryName(v.category)}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDuration(v.duration_seconds)}</td>
                <td className="px-4 py-3">
                  <select
                    value={v.tier_required}
                    onChange={async (e) => {
                      const ok = await updateVideo(v.id, { tier_required: e.target.value });
                      if (ok) toast(t("videos_list.tier_updated"), "success");
                    }}
                    className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="free">{t("videos_list.free")}</option>
                    <option value="pro">{t("videos_list.pro")}</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-text-secondary">{v.view_count}</td>
                <td className="px-4 py-3">
                  <Badge variant={v.is_deleted ? "red" : "green"}>
                    {v.is_deleted ? t("videos_list.deleted") : t("videos_list.active")}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(v)}
                      className="text-gold"
                    >
                      {tc("common.edit")}
                    </Button>
                    {v.is_deleted ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const ok = await updateVideo(v.id, { is_deleted: false });
                          if (ok) toast(t("videos_list.restored"), "success");
                        }}
                        className="text-success"
                      >
                        {t("videos_list.restore")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const ok = await updateVideo(v.id, { is_deleted: true });
                          if (ok) toast(t("videos_list.deleted"), "success");
                        }}
                        className="text-danger"
                      >
                        {t("videos_list.delete")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete({ id: v.id })}
                      className="text-danger"
                    >
                      {t("videos_list.hard_delete")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty / no results */}
      {filtered.length === 0 && (
        <p className="mt-4 text-center text-text-muted">
          {searchQuery.trim() ? t("videos_list.no_videos") : t("videos_list.no_videos")}
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            {t("videos_list.page", { page: safePage, total: totalPages })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              {t("videos_list.prev")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              {t("videos_list.next")}
            </Button>
          </div>
        </div>
      )}

      {/* Hard Delete ConfirmDialog */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleHardDelete}
        title={t("videos_list.hard_delete")}
        message={t("videos_list.delete_confirm")}
        confirmText={t("videos_list.hard_delete")}
        cancelText={tc("common.cancel")}
        loading={deleting}
        variant="danger"
      />

      {/* Upload / Edit Modal */}
      <Modal
        open={showUpload}
        onClose={closeModal}
        title={editingVideo ? t("videos_list.edit_video") : t("videos_list.modal_title")}
        size="lg"
      >
        <div className="space-y-4">
          {/* Video File Upload — only for new uploads */}
          {!editingVideo && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                {t("videos_list.video_file_required")}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer rounded-lg border-2 border-dashed border-border-default p-8 text-center transition-colors hover:border-gold/50 hover:bg-bg-tertiary/50"
              >
                {videoFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-text-primary">{videoFile.name}</p>
                    <p className="text-xs text-text-muted">
                      {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gold/10">
                      <svg className="h-5 w-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                    <p className="text-sm text-text-secondary">{t("videos_list.click_to_select")}</p>
                    <p className="text-xs text-text-muted">{t("videos_list.supported_formats")}</p>
                  </div>
                )}
              </div>
              {videoFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setVideoFile(null); }}
                  className="mt-1 text-xs text-danger hover:text-danger"
                >
                  {t("videos_list.remove_file")}
                </button>
              )}
            </div>
          )}

          {/* Upload/compression progress — only for new uploads */}
          {!editingVideo && uploading && (
            <div>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>{uploadPhase === "compressing" ? t("videos_list.compressing") : t("videos_list.uploading")}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          {!editingVideo && sizeWarning && (
            <p className="text-xs text-gold">{sizeWarning}</p>
          )}

          {/* Language selector — always visible */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">{t("videos_list.language")}</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
            >
              <option value="zh-CN">{LANGUAGE_LABELS["zh-CN"]}</option>
              <option value="en-US">{LANGUAGE_LABELS["en-US"]}</option>
              <option value="ms-MY">{LANGUAGE_LABELS["ms-MY"]}</option>
            </select>
          </div>

          {/* Thumbnail: file upload + URL fallback */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-secondary">{t("videos_list.thumbnail_url")}</label>
            {editingVideo && (
              <p className="text-xs text-text-muted">{t("videos_list.thumbnail_hint")}</p>
            )}
            {/* Hidden file input for thumbnail upload */}
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              onChange={handleThumbnailUpload}
              className="hidden"
            />
            {/* Preview + button row */}
            <div className="flex items-center gap-3">
              {thumbnailUrl && (
                <div className="relative h-16 w-28">
                  <Image
                    src={thumbnailUrl}
                    alt="thumbnail preview"
                    fill
                    className="rounded object-cover border border-border-default"
                    sizes="112px"
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                loading={thumbnailUploading}
                onClick={() => thumbInputRef.current?.click()}
              >
                {thumbnailUrl
                  ? t("videos_list.thumbnail_replace")
                  : t("videos_list.thumbnail_upload")}
              </Button>
            </div>
            {/* URL fallback */}
            <Input
              placeholder="https://..."
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
            />
          </div>

          {/* Duration */}
          <Input
            label={t("videos_list.duration_seconds")}
            type="number"
            placeholder="300"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />

          {/* Category & Tier row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">{t("videos_list.category_label")}</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                <option value="">{t("videos_list.none")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {getCategoryName(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">{t("videos_list.tier_required")}</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                <option value="free">{t("videos_list.tier_free_option")}</option>
                <option value="pro">{t("videos_list.tier_pro_option")}</option>
              </select>
            </div>
          </div>

          {/* Title — single field */}
          <Input
            label={t("videos_list.title_required")}
            placeholder={t("videos_list.title_placeholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Description — single field */}
          <Input
            label={t("videos_list.description_optional")}
            placeholder={t("videos_list.desc_placeholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {uploadError && <p className="text-sm text-danger">{uploadError}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={closeModal} disabled={uploading}>
              {tc("common.cancel")}
            </Button>
            {editingVideo ? (
              <Button variant="primary" loading={saving} onClick={handleSaveEdit}>
                {tc("common.save")}
              </Button>
            ) : (
              <Button variant="primary" loading={uploading} onClick={handleUpload}>
                {t("videos_list.upload_video")}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
