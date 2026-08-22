"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  MOBILE_TABS,
  GUEST_MOBILE_TABS,
  resolveActiveTab,
  resolveActiveGuestTab,
  type TabKey,
} from "@/lib/nav/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";

function TabIcon({ tab, className }: { tab: TabKey; className?: string }) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (tab) {
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.8V20h14V9.8" />
        </svg>
      );
    case "learn":
      return (
        <svg {...common}>
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
          <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
        </svg>
      );
    case "trade":
      return (
        <svg {...common}>
          <path d="M7 4v16M17 4v16" />
          <path d="M4 9h6V15H4zM14 7h6v9h-6z" />
        </svg>
      );
    case "screener":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.6-3.6" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="19" cy="12" r="1.4" />
        </svg>
      );
    // 访客底栏专用的两格
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4.5l8 7" />
          <path d="M6.5 10.5V20h11v-9.5" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case "tools":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h10M4 17h13" />
          <circle cx="17.5" cy="12" r="2" />
        </svg>
      );
  }
}

export function MobileTabBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const auth = useAuth();

  // 确认未登录才切访客底栏。auth.loading 期间沿用已登录那套，避免冷启动时
  // 底栏先闪一下 3 格再变成 5 格。
  const isGuest = !auth.loading && !auth.userId;
  const tabs = isGuest ? GUEST_MOBILE_TABS : MOBILE_TABS;

  const active = useMemo(
    () => (isGuest ? resolveActiveGuestTab(pathname, locale) : resolveActiveTab(pathname, locale)),
    [isGuest, pathname, locale]
  );

  // 此前这里对未登录用户整个 return null，理由是「5 个 tab 都会撞登录墙」。
  // 那条理由已经不成立了（筛选器、交易、学习内容对访客都是开放的），而且
  // 后果很实际：搜索进来的手机访客落在公开内容页上，除了返回键之外没有
  // 任何站内导航，桌面访客却仍有一整条顶栏。现在改成给访客一套与桌面
  // GUEST_NAV_ITEMS 同门槛的三格底栏。

  return (
    <nav
      // data-tabbar 供 globals.css 的 :has() 判断该给内容区留多少底部空间——
      // 访客底栏没有中央凸起，不需要为它让位
      data-tabbar={isGuest ? "guest" : "user"}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-default bg-bg-secondary/95 backdrop-blur-md pb-safe-b lg:hidden"
      aria-label={t("tab_more")}
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = active === tab.key;

          if (tab.center) {
            return (
              <div key={tab.key} className="flex w-[4.5rem] shrink-0 justify-center">
                <Link
                  href={tab.href(locale)}
                  aria-current={isActive ? "page" : undefined}
                  // 圆盘不显示文字标签，所以标签必须走 aria-label——而且要跟着
                  // 中央那一格实际是谁走，不能写死成某一个 tab
                  aria-label={t(`tab_${tab.key}`)}
                  className={cn(
                    // 凸起圆盘的上沿会侵入内容区，页面内容用 pb-tabbar 让位
                    "-mt-4 flex h-14 w-14 items-center justify-center rounded-full border transition-all",
                    "active:scale-[0.94] active:duration-75",
                    isActive
                      ? // 选中态是一枚真金箔圆章——底栏中央是全站视觉重心，
                        // 平涂金在这里撑不住
                        "foil border-transparent"
                      : "border-gold/40 bg-bg-tertiary text-gold"
                  )}
                >
                  <TabIcon tab={tab.key} className="h-6 w-6" />
                </Link>
              </div>
            );
          }

          return (
            <Link
              key={tab.key}
              href={tab.href(locale)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // min-h 44px 满足 iOS HIG 的触摸目标下限
                "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors",
                isActive ? "text-gold" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {/* 顶端一小段金箔：图标+文字变色之外再加一层位置指示，
                  色觉障碍用户不靠颜色也能看出当前在哪一栏 */}
              {isActive && (
                <span
                  aria-hidden
                  className="foil absolute inset-x-0 top-0 mx-auto h-[2px] w-8 rounded-none shadow-none"
                />
              )}
              <TabIcon tab={tab.key} className="h-5 w-5" />
              <span className="text-[11px] leading-none">{t(`tab_${tab.key}`)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
