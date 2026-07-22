"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { QueryProvider } from "@/components/layout/QueryProvider";

export function ClientLocaleLayout({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
}) {
  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <QueryProvider>
        <div className="flex min-h-screen flex-col">
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
