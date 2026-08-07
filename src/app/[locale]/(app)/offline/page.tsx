"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

export default function OfflinePage() {
  const t = useTranslations("pwa");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 h-px w-16 bg-gold/35" />
      <h1 className="font-display text-2xl tracking-tighter text-text-primary">
        {t("offline_title")}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-text-secondary">{t("offline_body")}</p>

      {/* 离线时最危险的误解是「以为单下出去了」，所以这条提示必须显眼 */}
      <p className="mt-6 rounded-xs border border-warning/30 bg-warning-bg px-4 py-3 text-xs leading-relaxed text-warning">
        {t("offline_warning")}
      </p>

      <Button className="mt-8" onClick={() => window.location.reload()}>
        {t("offline_retry")}
      </Button>
      <div className="mt-6 h-px w-16 bg-gold/35" />
    </div>
  );
}
