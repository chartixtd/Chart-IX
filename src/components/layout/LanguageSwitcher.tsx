"use client";

import { useRouter, usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useCallback } from "react";
import { LANGUAGE_LABELS, PUBLIC_LOCALES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * 语言切换：两个并排的微标签，当前语言金色。
 * 比 <select> 少一次点击、也少一个与世界格格不入的原生控件。
 * 隐藏的语言（如 ms-MY）只在当前正处于该语言时临时出现。
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const options: string[] = PUBLIC_LOCALES.includes(locale as (typeof PUBLIC_LOCALES)[number])
    ? [...PUBLIC_LOCALES]
    : [locale, ...PUBLIC_LOCALES];

  const switchLanguage = useCallback(
    (newLocale: string) => {
      document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        segments[0] = newLocale;
      } else {
        segments.unshift(newLocale);
      }
      router.push("/" + segments.join("/"));
    },
    [pathname, router]
  );

  return (
    <div className={cn("inline-flex items-center gap-1", className)} role="group" aria-label="Language">
      {options.map((code, i) => (
        <span key={code} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="mx-1.5 h-3 w-px bg-border-hover" />}
          <button
            type="button"
            onClick={() => switchLanguage(code)}
            aria-current={code === locale ? "true" : undefined}
            className={cn(
              "rounded-sm px-1.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold",
              code === locale ? "text-gold" : "text-text-muted hover:text-text-primary"
            )}
          >
            {LANGUAGE_LABELS[code] ?? code}
          </button>
        </span>
      ))}
    </div>
  );
}
