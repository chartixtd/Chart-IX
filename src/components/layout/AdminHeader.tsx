"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function AdminHeader() {
  const router = useRouter();
  const t = useTranslations("admin");
  const locale = useLocale();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });
  }, []);

  const handleLogout = async () => {
    // 先记审计再登出——signOut 之后会话已失效，requireAdmin 就认不出是谁了。
    await fetch("/api/admin/session-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "logout" }),
    }).catch(() => {});

    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(`/${locale}`);
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border-default bg-bg-primary/80 backdrop-blur-xl flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="Chart-IX" width={240} height={160} className="h-8 w-auto" />
        <span className="rounded-sm border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
          Admin
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}/dashboard`}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <span>←</span>
          <span>{t("back_to_site")}</span>
        </Link>

        {user && (
          <>
            <span className="text-xs text-text-tertiary">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm text-text-secondary hover:text-red-400 transition-colors"
            >
              {t("sign_out")}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
