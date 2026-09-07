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
    <div className="fixed inset-x-0 bottom-tabbar z-[60] flex items-center justify-between gap-3 border-t border-gold/40 bg-bg-secondary px-5 py-3 lg:bottom-0">
      <span className="text-xs text-text-secondary">{t("update_available")}</span>
      <button
        onClick={applyUpdate}
        className="gilt shrink-0 rounded-sm px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors"
      >
        {t("update_action")}
      </button>
    </div>
  );
}
