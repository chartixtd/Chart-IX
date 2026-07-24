"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { AuthProvider, type AuthState } from "@/components/auth/AuthProvider";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { QueryProvider } from "@/components/layout/QueryProvider";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { ToastProvider } from "@/components/ui/Toast";
import { PriceAlertWatcher } from "@/components/alerts/PriceAlertWatcher";

export function ClientLocaleLayout({
  children,
  locale,
  messages,
  initialAuth,
}: {
  children: ReactNode;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
  initialAuth?: AuthState;
}) {
  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <QueryProvider>
        <AuthProvider initialAuth={initialAuth}>
          <ToastProvider>
            <div className="flex min-h-screen flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <OnboardingModal />
            <PriceAlertWatcher />
          </ToastProvider>
        </AuthProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
