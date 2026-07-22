"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = ["home", "videos", "trade", "upgrade"] as const;

export function Navbar() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      const authUser = data.user ?? null;
      setUser(authUser);

      if (authUser) {
        try {
          const res = await fetch("/api/auth/me");
          if (res.ok) {
            const json = await res.json();
            setIsAdmin(json.user?.role === "admin");
          }
        } catch {
          // ignore
        }
      }

      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) setIsAdmin(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setIsAdmin(false);
    router.push(`/${locale}`);
    router.refresh();
  };

  const isActive = (item: string) => {
    const segments = pathname.split("/").filter(Boolean);
    if (item === "home") return segments.length === 1 || (segments.length === 1 && segments[0] === locale);
    return segments.includes(item);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border-default bg-bg-primary/80 backdrop-blur-xl">
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
          {NAV_ITEMS.map((item) => (
            <Link
              key={item}
              href={`/${locale}${item === "home" ? "" : `/${item}`}`}
              className={cn(
                "px-3 py-1.5 text-sm rounded-sm transition-colors",
                isActive(item)
                  ? "text-gold bg-gold/10"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              )}
            >
              {t(item)}
            </Link>
          ))}
          {isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "px-3 py-1.5 text-sm rounded-sm transition-colors",
                isActive("admin")
                  ? "text-gold bg-gold/10"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              )}
            >
              {t("admin")}
            </Link>
          )}
        </nav>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded bg-bg-tertiary" />
          ) : user ? (
            <>
              <Link href={`/${locale}/settings`}>
                <Button variant="ghost" size="sm">
                  {user.email?.split("@")[0]}
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                {t("sign_out")}
              </Button>
            </>
          ) : (
            <>
              <Link href={`/${locale}/login`}>
                <Button variant="ghost" size="sm">
                  {t("sign_in")}
                </Button>
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
