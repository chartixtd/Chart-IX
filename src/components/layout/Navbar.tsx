"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { purgePageCache } from "@/stores/pwa";
import { unsubscribeFromPush } from "@/lib/push/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

// 访客只看到首页与计算器；产品导航在登录墙后。
const GUEST_NAV_ITEMS = ["home", "tools"] as const;
const USER_NAV_ITEMS = ["dashboard", "videos", "articles", "news", "trade", "screener", "tools"] as const;

const NAV_HREF_OVERRIDES: Partial<Record<(typeof USER_NAV_ITEMS)[number], string>> = {
  tools: "/tools/position-size",
};

/**
 * 导航项：大写微标签。当前位置用一条从中心生长的 1px 金线标出——
 * 在三种语言的不同字宽下都能稳定读出「我在这里」。
 */
const NAV_LINK =
  "group relative flex h-[72px] items-center px-3.5 text-[11px] font-medium uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:text-gold";
const NAV_LINK_ACTIVE = "text-text-primary";
const NAV_LINK_IDLE = "text-text-muted hover:text-text-primary";

function ActiveLine({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-x-3.5 bottom-0 h-px origin-center bg-gold transition-transform duration-500 ease-out",
        active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100 group-hover:bg-gold/50"
      )}
    />
  );
}

export function Navbar() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();

  const showUpgrade = !auth.loading && auth.tier !== "pro";
  const isAdmin = auth.role === "admin";

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);

  const navLinks = useMemo(() => {
    const items = auth.userId ? USER_NAV_ITEMS : GUEST_NAV_ITEMS;
    return items.map((item) => {
      const active =
        item === "home" ? segments.length === 1 && segments[0] === locale : segments.includes(item);
      return (
        <Link
          key={item}
          href={`/${locale}${item === "home" ? "" : NAV_HREF_OVERRIDES[item] ?? `/${item}`}`}
          aria-current={active ? "page" : undefined}
          className={cn(NAV_LINK, active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE)}
        >
          {t(item)}
          <ActiveLine active={active} />
        </Link>
      );
    });
  }, [segments, locale, t, auth.userId]);

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    // 退订必须排在 signOut() 之前（/api/push/unsubscribe 要鉴权）；失败也不能挡住登出。
    await unsubscribeFromPush().catch(() => {});
    await supabase.auth.signOut();
    await purgePageCache();
    router.push(`/${locale}`);
    router.refresh();
  }, [locale, router]);

  const upgradeActive = segments.includes("upgrade");
  const adminActive = segments[0] === "admin";

  return (
    // 顶栏是站内唯一常驻的玻璃面：它不高频重绘，blur 在这里是安全的。
    <header className="gpu sticky top-0 z-40 hidden border-b border-border-default bg-bg-primary/80 shadow-nav backdrop-blur-xl lg:block">
      <div className="mx-auto flex h-[72px] max-w-page items-center px-6">
        {/* 品牌 */}
        <Link
          href={auth.userId ? `/${locale}/dashboard` : `/${locale}`}
          className="flex shrink-0 items-center gap-3"
          aria-label="Chart-IX"
        >
          <Image src="/logo.png" alt="" width={240} height={160} priority className="h-8 w-auto" />
          <span className="font-display text-[15px] font-medium tracking-[0.02em] text-text-primary">
            Chart<span className="text-gold">-IX</span>
          </span>
        </Link>

        {/* 导航 */}
        <nav className="ml-12 flex items-center">
          {navLinks}
          {showUpgrade && (
            <Link
              href={`/${locale}/upgrade`}
              aria-current={upgradeActive ? "page" : undefined}
              className={cn(NAV_LINK, upgradeActive ? NAV_LINK_ACTIVE : "text-gold/80 hover:text-gold")}
            >
              {t("upgrade")}
              <ActiveLine active={upgradeActive} />
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              aria-current={adminActive ? "page" : undefined}
              className={cn(NAV_LINK, adminActive ? NAV_LINK_ACTIVE : NAV_LINK_IDLE)}
            >
              {t("admin")}
              <ActiveLine active={adminActive} />
            </Link>
          )}
        </nav>

        {/* 右侧 */}
        <div className="ml-auto flex items-center gap-5">
          <LanguageSwitcher />
          <span aria-hidden className="h-4 w-px bg-border-hover" />
          {auth.loading ? (
            <Skeleton className="h-8 w-24" />
          ) : auth.userId ? (
            <>
              <Link
                href={`/${locale}/settings`}
                className="max-w-[10rem] truncate text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text-primary"
              >
                {auth.displayName || auth.email?.split("@")[0]}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text-primary"
              >
                {t("sign_out")}
              </button>
            </>
          ) : (
            <>
              <Link
                href={`/${locale}/login`}
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text-primary"
              >
                {t("sign_in")}
              </Link>
              <Link href={`/${locale}/register`}>
                <Button size="sm" className="h-9 px-5 text-[11px] uppercase tracking-[0.16em]">
                  {t("sign_up")}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
