"use client";

import { NextIntlClientProvider } from "next-intl";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider, type AuthState } from "@/components/auth/AuthProvider";
import { ZoomGuard } from "@/components/pwa/ZoomGuard";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { QueryProvider } from "@/components/layout/QueryProvider";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { ToastProvider } from "@/components/ui/Toast";
import { PriceAlertWatcher } from "@/components/alerts/PriceAlertWatcher";
import { PaperTpSlWatcher } from "@/components/alerts/PaperTpSlWatcher";
import { PreferencesSync } from "@/components/preferences/PreferencesSync";

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
  // 交易终端是工具页，不是营销页——底部这条"品牌+介绍+社群链接"的 footer 在这里
  // 纯粹是滚动过图表/持仓面板之后的死区，只在非 /trade 页面显示
  const pathname = usePathname();
  const isTradePage = pathname === `/${locale}/trade` || pathname?.startsWith(`/${locale}/trade/`);

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <QueryProvider>
        <AuthProvider initialAuth={initialAuth}>
          <ToastProvider>
            <ZoomGuard />
            <div className="flex min-h-screen flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              {!isTradePage && <Footer />}
            </div>
            <OnboardingModal />
            <PriceAlertWatcher />
            <PaperTpSlWatcher />
            <PreferencesSync />
          </ToastProvider>
        </AuthProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
