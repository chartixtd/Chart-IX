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
    strokeWidth: 1.5,
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
          <circle cx="5" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="19" cy="12" r="1.2" />
        </svg>
      );
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

/**
 * 手机底栏。已登录五格、访客三格。中央凸起的金圆盘给「选币」——
 * 它是全站每天要你做的第一件事。选中态是一枚真金箔圆章。
 */
export function MobileTabBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const auth = useAuth();

  const isGuest = !auth.loading && !auth.userId;
  const tabs = isGuest ? GUEST_MOBILE_TABS : MOBILE_TABS;

  const active = useMemo(
    () => (isGuest ? resolveActiveGuestTab(pathname, locale) : resolveActiveTab(pathname, locale)),
    [isGuest, pathname, locale]
  );

  return (
    <nav
      data-tabbar={isGuest ? "guest" : "user"}
      // 不透明底：fixed 底栏在交易页正压着 K 线画布，backdrop-blur 会让低端安卓掉帧
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-default bg-bg-primary pb-safe-b lg:hidden"
      aria-label={t("tab_more")}
    >
      <div className="hairline-gold absolute inset-x-0 top-0 opacity-40" />
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = active === tab.key;

          if (tab.center) {
            return (
              <div key={tab.key} className="flex w-[4.5rem] shrink-0 justify-center">
                <Link
                  href={tab.href(locale)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={t(`tab_${tab.key}`)}
                  className={cn(
                    "-mt-4 flex h-14 w-14 items-center justify-center rounded-full border transition-all",
                    "active:scale-[0.94] active:duration-75",
                    isActive ? "foil border-transparent" : "border-gold/50 bg-bg-secondary text-gold"
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
                "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors",
                isActive ? "text-gold" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {isActive && (
                <span aria-hidden className="absolute inset-x-0 top-0 mx-auto h-px w-8 bg-gold" />
              )}
              <TabIcon tab={tab.key} className="h-5 w-5" />
              <span className="text-[10px] uppercase leading-none tracking-[0.12em]">
                {t(`tab_${tab.key}`)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
