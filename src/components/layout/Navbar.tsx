"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = ["home", "videos", "articles", "trade"] as const;

export function Navbar() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();

  // Only show upgrade once auth has loaded and the user is confirmed non-pro —
  // avoids the upgrade link flashing for pro users during the loading window.
  const showUpgrade = !auth.loading && auth.tier !== "pro";
  const isAdmin = auth.role === "admin";

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);

  const navLinks = useMemo(() => {
    return NAV_ITEMS.map((item) => {
      const active = item === "home"
        ? segments.length === 1 || segments[0] === locale
        : segments.includes(item);
      return (
        <Link
          key={item}
          href={`/${locale}${item === "home" ? "" : `/${item}`}`}
          className={cn(
            "px-3 py-1.5 text-sm rounded-sm transition-colors",
            active ? "text-gold bg-gold/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
          )}
        >
          {t(item)}
        </Link>
      );
    });
  }, [segments, locale, t]);

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(`/${locale}`);
    router.refresh();
  }, [locale, router]);

  return (
    <header className="sticky top-0 z-40 border-b border-border-default bg-bg-primary/80 backdrop-blur-md gpu">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex items-center gap-2 shrink-0">
          <span className="text-xl font-bold tracking-tight">
            <span className="gold-text">Chart</span>
            <span className="text-text-primary">-IX</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks}
          {showUpgrade && (
            <Link
              href={`/${locale}/upgrade`}
              className={cn(
                "px-3 py-1.5 text-sm rounded-sm transition-colors",
                segments.includes("upgrade") ? "text-gold bg-gold/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              )}
            >
              {t("upgrade")}
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "px-3 py-1.5 text-sm rounded-sm transition-colors",
                segments[0] === "admin" ? "text-gold bg-gold/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              )}
            >
              {t("admin")}
            </Link>
          )}
        </nav>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {auth.loading ? (
            <div className="h-8 w-20 animate-pulse rounded bg-bg-tertiary" />
          ) : auth.userId ? (
            <>
              <Link href={`/${locale}/settings`}>
                <Button variant="ghost" size="sm">
                  {auth.email?.split("@")[0]}
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                {t("sign_out")}
              </Button>
            </>
          ) : (
            <>
              <Link href={`/${locale}/login`}>
                <Button variant="ghost" size="sm">{t("sign_in")}</Button>
              </Link>
              <Link href={`/${locale}/register`}>
                <Button size="sm">{t("sign_up")}</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
