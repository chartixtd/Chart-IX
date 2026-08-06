"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

type ValidLocale = "zh-CN" | "en-US" | "ms-MY";

function isValidLocale(s: string | undefined): s is ValidLocale {
  return s === "zh-CN" || s === "en-US" || s === "ms-MY";
}

function getLocaleFromCookie(): ValidLocale {
  if (typeof document === "undefined") return "en-US";
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]*)/);
  return isValidLocale(match?.[1]) ? match![1] : "en-US";
}

export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<ValidLocale>("en-US");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [messages, setMessages] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const loc = getLocaleFromCookie();
    setLocale(loc);
    document.documentElement.lang = loc;
    // Dynamic import of the locale messages (client-side, no server cookies needed)
    import(`@/i18n/messages/${loc}.json`).then((mod) => {
      setMessages(mod.default);
    });
  }, []);

  if (!messages) {
    // Short loading state while messages are fetched
    return <div className="min-h-screen bg-bg-primary" />;
  }

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      {children}
    </NextIntlClientProvider>
  );
}
