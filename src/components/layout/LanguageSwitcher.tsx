"use client";

import { useRouter, usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useCallback } from "react";
import { LANGUAGE_LABELS, PUBLIC_LOCALES } from "@/lib/constants";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  // 隐藏的语言（如 ms-MY）不出现在选项里；但若当前正处于该语言，
  // 需临时保留它作为选项，避免 select value 失配
  const options: string[] = PUBLIC_LOCALES.includes(locale as (typeof PUBLIC_LOCALES)[number])
    ? [...PUBLIC_LOCALES]
    : [locale, ...PUBLIC_LOCALES];

  const switchLanguage = useCallback((newLocale: string) => {
    // Persist language preference via cookie (read by middleware & next-intl)
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;

    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      segments[0] = newLocale;
    } else {
      segments.unshift(newLocale);
    }
    router.push("/" + segments.join("/"));
  }, [pathname, router]);

  return (
    <select
      value={locale}
      onChange={(e) => switchLanguage(e.target.value)}
      className="cursor-pointer rounded-sm border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-secondary shadow-[inset_0_1px_0_rgba(0,0,0,0.35)] transition-colors hover:border-border-hover focus:outline-none focus:ring-1 focus:ring-gold/60"
    >
      {options.map((code) => (
        <option key={code} value={code}>
          {LANGUAGE_LABELS[code] ?? code}
        </option>
      ))}
    </select>
  );
}
