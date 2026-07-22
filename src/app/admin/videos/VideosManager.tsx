"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import type { Video, VideoCategory } from "@/types";

interface VideosManagerProps {
  videos: Video[];
  categories: VideoCategory[];
}

type Locale = "zh-CN" | "en-US" | "ms-MY";

export function VideosManager({ videos, categories }: VideosManagerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  // Upload form fields
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleMs, setTitleMs] = useState("");
  const [descZh, setDescZh] = useState("");
  const [descEn, setDescEn] = useState("");
  const [descMs, setDescMs] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tier, setTier] = useState("free");

  const resetForm = () => {
    setVideoFile(null);
    setTitleZh("");
    setTitleEn("");
    setTitleMs("");
    setDescZh("");
    setDescEn("");
    setDescMs("");
    setThumbnailUrl("");
    setDuration("");
    setCategoryId("");
    setTier("free");
    setUploadError("");
    setUploadProgress(0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setUploadError("");
    }
  };

  const handleUpload = async () => {
    if (!videoFile) {
      setUploadError("Please select a video file");
      return;
    }
    if (!titleEn.trim() && !titleZh.trim() && !titleMs.trim()) {
      setUploadError("At least one title is required");
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadProgress(10);

    try {
      const supabase = createClient();

      // Generate unique filename
      const fileExt = videoFile.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      // Get presigned upload URL from Supabase (bypasses client-side 50MB limit)
      const { data: signedData, error: signedErr } = await supabase.storage
        .from("videos")
        .createSignedUploadUrl(fileName);

      if (signedErr || !signedData?.signedUrl) {
        setUploadError(`Failed to get upload URL: ${signedErr?.message ?? "Unknown error"}`);
        setUploading(false);
        return;
      }

      setUploadProgress(20);

      // Upload directly to the presigned URL
      const uploadResponse = await fetch(signedData.signedUrl, {
        method: "PUT",
        body: videoFile,
        headers: {
          "Content-Type": videoFile.type || "application/octet-stream",
          "x-upsert": "false",
        },
      });

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        setUploadError(`Upload failed: ${errText || uploadResponse.statusText}`);
        setUploading(false);
        return;
      }

      setUploadProgress(80);

      // Get public URL
      const { data: urlData } = supabase.storage.from("videos").getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      // Send metadata to API to create video record
      const title: Record<string, string> = {};
      if (titleZh.trim()) title["zh-CN"] = titleZh.trim();
      if (titleEn.trim()) title["en-US"] = titleEn.trim();
      if (titleMs.trim()) title["ms-MY"] = titleMs.trim();

      const description: Record<string, string> = {};
      if (descZh.trim()) description["zh-CN"] = descZh.trim();
      if (descEn.trim()) description["en-US"] = descEn.trim();
      if (descMs.trim()) description["ms-MY"] = descMs.trim();

      const res = await fetch("/api/admin/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: Object.keys(description).length > 0 ? description : null,
          category_id: categoryId ? parseInt(categoryId) : null,
          storage_url: publicUrl,
          thumbnail_url: thumbnailUrl.trim() || null,
          duration_seconds: duration ? parseInt(duration) : 0,
          tier_required: tier,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create video record");
      }

      setUploadProgress(100);
      resetForm();
      setShowUpload(false);
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const updateVideo = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/api/admin/videos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) router.refresh();
  };

  const deleteVideo = async (id: string) => {
    const res = await fetch("/api/admin/videos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) router.refresh();
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const getTitle = (video: Video): string => {
    return video.title?.["en-US"] ?? video.title?.["zh-CN"] ?? video.title?.["ms-MY"] ?? "Untitled";
  };

  const getCategoryName = (cat: VideoCategory | undefined): string => {
    if (!cat) return "-";
    return cat.name?.["en-US"] ?? cat.name?.["zh-CN"] ?? cat.name?.["ms-MY"] ?? cat.slug;
  };

  return (
    <div>
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-secondary">{videos.length} videos total</p>
        <Button variant="primary" size="sm" onClick={() => setShowUpload(true)}>
          + Add Video
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">Title</th>
              <th className="px-4 py-3 text-text-muted">Category</th>
              <th className="px-4 py-3 text-text-muted">Duration</th>
              <th className="px-4 py-3 text-text-muted">Tier</th>
              <th className="px-4 py-3 text-text-muted">Views</th>
              <th className="px-4 py-3 text-text-muted">Status</th>
              <th className="px-4 py-3 text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => (
              <tr key={v.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td className="max-w-[240px] truncate px-4 py-3 text-text-primary" title={getTitle(v)}>
                  {getTitle(v)}
                </td>
                <td className="px-4 py-3 text-text-secondary">{getCategoryName(v.category)}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDuration(v.duration_seconds)}</td>
                <td className="px-4 py-3">
                  <select
                    value={v.tier_required}
                    onChange={(e) => updateVideo(v.id, { tier_required: e.target.value })}
                    className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-text-secondary">{v.view_count}</td>
                <td className="px-4 py-3">
                  <Badge variant={v.is_deleted ? "red" : "green"}>
                    {v.is_deleted ? "Deleted" : "Active"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {v.is_deleted ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateVideo(v.id, { is_deleted: false })}
                        className="text-green-400"
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateVideo(v.id, { is_deleted: true })}
                        className="text-red-400"
                      >
                        Delete
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Permanently delete this video?")) {
                          deleteVideo(v.id);
                        }
                      }}
                      className="text-red-500"
                    >
                      Hard Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {videos.length === 0 && (
        <p className="mt-4 text-center text-text-muted">No videos found.</p>
      )}

      {/* Upload Modal */}
      <Modal open={showUpload} onClose={() => { setShowUpload(false); resetForm(); }} title="Add New Video" size="lg">
        <div className="space-y-4">
          {/* Video File Upload */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Video File *
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
                  <p className="text-sm text-text-secondary">Click to select video file</p>
                  <p className="text-xs text-text-muted">MP4, WebM, MOV supported</p>
                </div>
              )}
            </div>
            {videoFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setVideoFile(null); }}
                className="mt-1 text-xs text-red-400 hover:text-red-300"
              >
                Remove file
              </button>
            )}
          </div>

          {/* Upload progress */}
          {uploading && uploadProgress > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>Uploading...</span>
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

          {/* Thumbnail URL */}
          <Input
            label="Thumbnail URL (optional)"
            placeholder="https://..."
            value={thumbnailUrl}
            onChange={(e) => setThumbnailUrl(e.target.value)}
          />

          {/* Duration */}
          <Input
            label="Duration (seconds)"
            type="number"
            placeholder="300"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />

          {/* Category & Tier row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {getCategoryName(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">Tier Required</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
            </div>
          </div>

          {/* Title fields */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">Title (at least one required)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label="中文 (zh-CN)"
                placeholder="视频标题"
                value={titleZh}
                onChange={(e) => setTitleZh(e.target.value)}
              />
              <Input
                label="English (en-US)"
                placeholder="Video title"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
              />
              <Input
                label="Bahasa (ms-MY)"
                placeholder="Tajuk video"
                value={titleMs}
                onChange={(e) => setTitleMs(e.target.value)}
              />
            </div>
          </div>

          {/* Description fields */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">Description (optional)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label="中文 (zh-CN)"
                placeholder="视频描述"
                value={descZh}
                onChange={(e) => setDescZh(e.target.value)}
              />
              <Input
                label="English (en-US)"
                placeholder="Video description"
                value={descEn}
                onChange={(e) => setDescEn(e.target.value)}
              />
              <Input
                label="Bahasa (ms-MY)"
                placeholder="Penerangan video"
                value={descMs}
                onChange={(e) => setDescMs(e.target.value)}
              />
            </div>
          </div>

          {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowUpload(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={uploading} onClick={handleUpload}>
              Upload Video
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
