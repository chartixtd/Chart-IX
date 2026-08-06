"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { uploadCommunityImage, type PostComposerInput } from "@/hooks/useCommunity";

const TITLE_MAX = 200;
const BODY_MAX = 10_000;

interface PostComposerModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: PostComposerInput) => Promise<void>;
  submitting: boolean;
  error: string | null;
  initial?: PostComposerInput;
}

/** Shared field chrome — mirrors src/components/ui/Input.tsx so the composer's
 *  hand-rolled fields focus and hover exactly like every other input. */
// placeholder uses text-secondary, not text-muted: muted lands at 3.13:1 on this
// surface, under the 4.5:1 floor for placeholder text. secondary is 6.68:1 and
// still reads as a hint, since typed content sits far brighter at 15.44:1.
const FIELD_BASE =
  "w-full rounded-sm border border-border-default bg-bg-tertiary text-text-primary placeholder:text-text-secondary " +
  "transition-all duration-200 hover:border-border-hover " +
  "focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/60";

/** Counter goes gold near the cap and danger at it, so the limit is felt before it bites. */
function CharCount({ value, max }: { value: number; max: number }) {
  const ratio = value / max;
  return (
    <span
      className={cn(
        "font-mono text-[11px] tabular-nums transition-colors",
        value >= max ? "text-danger" : ratio >= 0.8 ? "text-gold" : "text-text-muted"
      )}
    >
      {value}/{max}
    </span>
  );
}

function FieldLabel({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium uppercase tracking-wider text-text-secondary">
      {children}
      {required && <span className="ml-1 text-gold">*</span>}
    </label>
  );
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

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), content: content.trim(), cover_image: coverImage || null });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t("edit_post") : t("new_post")}
      size="lg"
      // A composer needs room to write in; twMerge lets this win over size's max-w-lg.
      // sheet = bottom sheet on mobile, where a centered dialog gets half-eaten by the keyboard.
      variant="sheet"
      className="max-w-2xl"
    >
      {/* Cmd/Ctrl+Enter submits from anywhere in the form — the muscle memory for
          any compose box. Plain Enter stays free for newlines in the body. */}
      <div
        className="space-y-6"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      >
        {/* Title — the headline, so it gets the largest type in the form */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor="composer-title" required>
              {t("title_placeholder")}
            </FieldLabel>
            <CharCount value={title.length} max={TITLE_MAX} />
          </div>
          <input
            id="composer-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder={t("title_placeholder")}
            className={cn(FIELD_BASE, "px-3.5 py-2.5 text-base font-medium")}
          />
        </div>

        {/* Body */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor="composer-body" required>
              {t("body_label")}
            </FieldLabel>
            <CharCount value={content.length} max={BODY_MAX} />
          </div>
          <textarea
            id="composer-body"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={BODY_MAX}
            rows={10}
            placeholder={t("content_placeholder")}
            className={cn(FIELD_BASE, "resize-y px-3.5 py-3 text-sm leading-relaxed")}
          />
        </div>

        {/* Cover — previewed at 16:9, the exact crop the feed card applies, so
            what the author approves here is what everyone else sees. */}
        <div className="space-y-2">
          <FieldLabel htmlFor="community-cover-upload">{t("cover_image")}</FieldLabel>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            id="community-cover-upload"
          />

          {coverImage ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-border-default">
              <Image src={coverImage} alt="" fill className="object-cover" sizes="(min-width: 768px) 42rem, 100vw" />
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-bg-primary/90 to-transparent p-2.5">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? t("uploading") : t("replace_image")}
                </Button>
                <Button type="button" variant="danger" size="sm" onClick={() => setCoverImage("")} disabled={uploading}>
                  {t("remove_image")}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={cn(
                "flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-sm",
                "border border-dashed border-border-default bg-bg-tertiary/40 text-text-muted",
                "transition-colors hover:border-gold/40 hover:bg-bg-tertiary hover:text-text-secondary",
                "focus:outline-none focus:ring-1 focus:ring-gold/60 disabled:opacity-60"
              )}
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 16.5l4.5-4.5a2 2 0 012.83 0L15 16.5m-2-2l1.5-1.5a2 2 0 012.83 0L21 16.5M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span className="text-xs font-medium">{uploading ? t("uploading") : t("add_image")}</span>
            </button>
          )}

          {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
        </div>

        {error && (
          <p className="rounded-sm border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>
        )}

        {/* Hairline-separated footer, per the house divider idiom */}
        <div className="flex items-center justify-end gap-3 border-t border-border-default pt-5">
          <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button variant="primary" size="md" disabled={!canSubmit} onClick={submit}>
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
