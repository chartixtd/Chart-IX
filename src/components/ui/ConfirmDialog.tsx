"use client";

import { Modal } from "./Modal";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  variant?: "danger" | "primary";
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  loading = false,
  variant = "danger",
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={loading ? () => {} : onClose} title={title} size="sm">
      <p className="mb-6 text-sm leading-relaxed text-text-secondary">{message}</p>
      {/* 破坏性操作与取消之间留出 gap-3：并排按钮的 44px 命中区不能互相压边 */}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button
          variant={variant === "danger" ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
