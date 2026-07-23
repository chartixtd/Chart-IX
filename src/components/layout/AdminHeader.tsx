"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

/** Read the persisted locale cookie, falling back to en-US */
function getSavedLocale(): string {
  if (typeof document === "undefined") return "en-US";
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]*)/);
  return match?.[1] || "en-US";
}

export function AdminHeader() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [locale] = useState(getSavedLocale);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(`/${locale}`);
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border-default bg-bg-primary/80 backdrop-blur-xl flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold">
          <span className="gold-text">Chart</span>
          <span className="text-text-primary">-IX</span>
        </span>
        <span className="rounded-sm border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
          Admin
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}`}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <span>←</span>
          <span>Back to Site</span>
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
              Sign Out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
