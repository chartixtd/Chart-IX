"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { createClient } from "@/lib/supabase/client";
import { buildMoreEntries } from "@/lib/nav/tabs";
import { purgePageCache } from "@/stores/pwa";

export default function MorePage() {
  const locale = useLocale();
  const t = useTranslations("nav");
  const auth = useAuth();
  const router = useRouter();

  const entries = useMemo(
    () => buildMoreEntries({ locale, tier: auth.tier ?? null, role: auth.role ?? null }),
    [locale, auth.tier, auth.role]
  );

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    await purgePageCache();
    router.push(`/${locale}`);
    router.refresh();
  }, [locale, router]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {auth.userId && (
        <div className="mb-6 border-b border-border-default pb-6">
          <p className="font-display text-xl tracking-tighter text-text-primary">
            {auth.displayName || auth.email?.split("@")[0]}
          </p>
          <p className="mt-1 text-xs text-text-muted">{auth.email}</p>
        </div>
      )}

      {/* 发丝线台账列表，不用卡片堆叠 —— 见 DESIGN.md 的 prohibitions */}
      <ul className="divide-y divide-border-default border-y border-border-default">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              href={entry.href}
              className="flex min-h-[52px] items-center justify-between px-1 py-3.5 text-sm text-text-primary transition-colors active:bg-bg-tertiary"
            >
              <span>{t(`more_${entry.key}`)}</span>
              <svg
                className="h-4 w-4 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between border-b border-border-default pb-4">
        <span className="text-sm text-text-secondary">{t("language")}</span>
        <LanguageSwitcher />
      </div>

      {auth.userId && (
        <button
          onClick={handleLogout}
          className="mt-6 w-full rounded-sm border border-border-default py-3 text-sm text-text-secondary transition-colors active:bg-bg-tertiary"
        >
          {t("sign_out")}
        </button>
      )}
    </div>
  );
}
