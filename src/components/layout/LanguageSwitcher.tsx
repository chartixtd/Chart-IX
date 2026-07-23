"use client";

import { useRouter, usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useCallback } from "react";
import { LANGUAGE_LABELS } from "@/lib/constants";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

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
      className="rounded-sm border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-secondary hover:border-border-hover focus:outline-none focus:ring-1 focus:ring-gold/50 cursor-pointer"
    >
      {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}
