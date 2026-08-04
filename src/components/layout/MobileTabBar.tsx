"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { MOBILE_TABS, resolveActiveTab, type TabKey } from "@/lib/nav/tabs";
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
  }
}

export function MobileTabBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const auth = useAuth();

  const active = useMemo(() => resolveActiveTab(pathname, locale), [pathname, locale]);

  // Signed-out visitors get no product nav here, mirroring desktop Navbar's
  // GUEST_NAV_ITEMS decision — the 5 tabs all dead-end in login prompts, which
  // is exactly the "teasing" the desktop nav was built to avoid. Keep rendering
  // during the loading window (auth.loading) to avoid a flash/flicker; only
  // suppress once auth has resolved and confirmed there's no user.
  if (!auth.loading && !auth.userId) {
    return null;
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-default bg-bg-secondary/95 backdrop-blur-md pb-safe-b lg:hidden"
      aria-label={t("tab_more")}
    >
      <div className="flex items-stretch">
        {MOBILE_TABS.map((tab) => {
          const isActive = active === tab.key;

          if (tab.center) {
            return (
              <div key={tab.key} className="flex w-[4.5rem] shrink-0 justify-center">
                <Link
                  href={tab.href(locale)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={t("tab_trade")}
                  className={cn(
                    // 凸起圆盘的上沿会侵入内容区，页面内容用 pb-tabbar 让位
                    "-mt-4 flex h-14 w-14 items-center justify-center rounded-full border transition-colors",
                    isActive
                      ? "border-gold bg-gold text-bg-primary"
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
                "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors",
                isActive ? "text-gold" : "text-text-muted hover:text-text-secondary"
              )}
            >
              <TabIcon tab={tab.key} className="h-5 w-5" />
              <span className="text-[11px] leading-none">{t(`tab_${tab.key}`)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
