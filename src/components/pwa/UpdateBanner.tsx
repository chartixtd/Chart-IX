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
    // 挂在底栏上方而不是盖住顶部 header：fixed top-0 会压住返回按钮/Logo，
    // 不点「更新」就没法导航。桌面没有底栏，贴底即可。
    <div className="fixed inset-x-0 bottom-tabbar z-[60] flex items-center justify-between gap-3 border-y border-gold/35 bg-bg-secondary px-4 py-2 lg:bottom-0 lg:border-b-0">
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
