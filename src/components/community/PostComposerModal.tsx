"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { uploadCommunityImage, type PostComposerInput } from "@/hooks/useCommunity";

interface PostComposerModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: PostComposerInput) => Promise<void>;
  submitting: boolean;
  error: string | null;
  initial?: PostComposerInput;
}

export function PostComposerModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
  initial,
}: PostComposerModalProps) {
  const t = useTranslations("community");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [coverImage, setCoverImage] = useState(initial?.cover_image ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次打开时把表单重置成对应的初始值——同一个弹窗在"新帖"和"编辑"之间复用，
  // 不重置的话上一次编辑的草稿会漏进下一次的新帖表单里
  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setContent(initial?.content ?? "");
      setCoverImage(initial?.cover_image ?? "");
      setUploadError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadCommunityImage(file);
      setCoverImage(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !submitting && !uploading;

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("edit_post") : t("new_post")} size="lg">
      <div className="space-y-3">
        <Input
          placeholder={t("title_placeholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <textarea
          placeholder={t("content_placeholder")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={10_000}
          rows={8}
          className="w-full resize-y rounded-sm border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
        />

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("cover_image")}</label>
          {coverImage && (
            <div className="relative mb-2 h-32 w-full overflow-hidden rounded-sm border border-border-default">
              {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, matches ArticlesManager's cover image preview */}
              <img src={coverImage} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setCoverImage("")}
                className="absolute right-1.5 top-1.5 rounded-full bg-bg-primary/80 px-2 py-0.5 text-xs text-text-primary hover:text-danger"
              >
                {t("remove_image")}
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="community-cover-upload" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? t("uploading") : coverImage ? t("replace_image") : t("add_image")}
          </Button>
          {uploadError && <p className="mt-1 text-xs text-danger">{uploadError}</p>}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={() => onSubmit({ title: title.trim(), content: content.trim(), cover_image: coverImage || null })}
          >
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
