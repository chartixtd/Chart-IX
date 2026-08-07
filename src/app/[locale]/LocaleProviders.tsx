"use client";

import { NextIntlClientProvider } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { QueryProvider } from "@/components/layout/QueryProvider";

export function LocaleProviders({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
}) {
  // The root layout (src/app/layout.tsx) can't know the locale — it's above
  // the [locale] segment and reading it there would force the whole app into
  // dynamic rendering. Setting it here also keeps it correct when the
  // language switcher does a client-side navigation between locales, which
  // doesn't re-run the root layout.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <QueryProvider>{children}</QueryProvider>
    </NextIntlClientProvider>
  );
}
