"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface PostComposerModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; content: string }) => Promise<void>;
  submitting: boolean;
  error: string | null;
  initial?: { title: string; content: string };
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

  // 每次打开时把表单重置成对应的初始值——同一个弹窗在"新帖"和"编辑"之间复用，
  // 不重置的话上一次编辑的草稿会漏进下一次的新帖表单里
  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setContent(initial?.content ?? "");
    }
  }, [open, initial]);

  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !submitting;

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
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={() => onSubmit({ title: title.trim(), content: content.trim() })}
          >
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
