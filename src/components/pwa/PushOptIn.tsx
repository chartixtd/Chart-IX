"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { readPlatform } from "@/lib/pwa/platform";
import { subscribeToPush } from "@/lib/push/client";

export function PushOptIn({
  open,
  onClose,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  onGranted?: () => void;
}) {
  const t = useTranslations("pwa");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const platform = typeof window === "undefined" ? null : readPlatform();
  // iOS 上没装到主屏时申请权限也不会成功，弹出来只会让人困惑
  const needsInstallFirst = platform?.os === "ios" && !platform.isStandalone;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await subscribeToPush(locale);
      if (result === "ok") {
        onGranted?.();
        onClose();
        return;
      }
      if (result === "denied") {
        setError(t("push_denied"));
      } else if (result === "error") {
        setError(t("push_error"));
      } else {
        setError(t("push_unsupported"));
      }
    } finally {
      // finally 而不是一句 setBusy(false)：subscribeToPush 现在已经自己兜住了
      // 异常，但这个按钮的 loading 态不该依赖那个约定——任何一条抛出的路径
      // （包括将来新加的）都会把按钮永久锁在转圈状态，而弹窗里没有别的出口。
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("push_title")} variant="sheet" size="sm">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-text-secondary">{t("push_body")}</p>

        {needsInstallFirst ? (
          <p className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            {t("push_ios_install_first")}
          </p>
        ) : (
          <>
            {error && (
              <p className="rounded-xs border border-danger/30 bg-danger-bg px-3 py-2 text-xs leading-relaxed text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={enable} loading={busy} className="flex-1">
                {t("push_enable")}
              </Button>
              {/* 点「以后再说」什么都不发生——提醒照常存下，下次再问 */}
              <Button variant="ghost" onClick={onClose} className="flex-1">
                {t("push_later")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
