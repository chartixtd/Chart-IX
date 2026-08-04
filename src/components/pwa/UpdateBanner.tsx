"use client";

import { useTranslations } from "next-intl";
import { usePwaStore } from "@/stores/pwa";

export function UpdateBanner() {
  const t = useTranslations("pwa");
  const updateReady = usePwaStore((s) => s.updateReady);
  const hasPendingOrder = usePwaStore((s) => s.hasPendingOrder);
  const applyUpdate = usePwaStore((s) => s.applyUpdate);

  // 用户可能正在填下单表单，被新版本接管会丢掉未提交的状态——
  // 有未确认订单时闭嘴，等流程走完再提示
  if (!updateReady || hasPendingOrder) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-between gap-3 border-b border-gold/35 bg-bg-secondary px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <span className="text-xs text-text-secondary">{t("update_available")}</span>
      <button
        onClick={applyUpdate}
        className="shrink-0 rounded-xs bg-gold px-3 py-1 text-xs font-medium text-bg-primary transition-colors hover:bg-gold-hover"
      >
        {t("update_action")}
      </button>
    </div>
  );
}
