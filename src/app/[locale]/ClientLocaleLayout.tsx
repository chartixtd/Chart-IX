"use client";

import { NextIntlClientProvider } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AuthProvider, type AuthState } from "@/components/auth/AuthProvider";
import { ZoomGuard } from "@/components/pwa/ZoomGuard";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { UpdateBanner } from "@/components/pwa/UpdateBanner";
import { Navbar } from "@/components/layout/Navbar";
import { MobileShell } from "@/components/layout/MobileShell";
import { Footer } from "@/components/layout/Footer";
import { QueryProvider } from "@/components/layout/QueryProvider";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ToastProvider } from "@/components/ui/Toast";
import { PriceAlertWatcher } from "@/components/alerts/PriceAlertWatcher";
import { PaperTpSlWatcher } from "@/components/alerts/PaperTpSlWatcher";
import { PreferencesSync } from "@/components/preferences/PreferencesSync";
import type { SiteSettings } from "@/lib/site-settings";

export function ClientLocaleLayout({
  children,
  locale,
  messages,
  initialAuth,
  siteSettings,
}: {
  children: ReactNode;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
  initialAuth?: AuthState;
  siteSettings: SiteSettings;
}) {
  // 交易终端是工具页，不是营销页——底部这条"品牌+介绍+社群链接"的 footer 在这里
  // 纯粹是滚动过图表/持仓面板之后的死区，只在非 /trade 页面显示
  const pathname = usePathname();
  const isTradePage = pathname === `/${locale}/trade` || pathname?.startsWith(`/${locale}/trade/`);

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
      <QueryProvider>
        <AuthProvider initialAuth={initialAuth}>
          <ToastProvider>
            <ZoomGuard />
            <ServiceWorkerRegistrar />
            <UpdateBanner />
            <div className="flex min-h-dvh flex-col">
              <Navbar />
              <MobileShell>
                {/* pb-tabbar 给底部导航条 + 中央凸起 + 系统安全区统一让位 */}
                <main className="flex-1 pb-tabbar lg:pb-0">{children}</main>
                {/* 手机上 footer 沉在 tab bar 下面没人看得到，只在桌面渲染 */}
                {!isTradePage && (
                  <div className="hidden lg:block">
                    <Footer settings={siteSettings} />
                  </div>
                )}
              </MobileShell>
            </div>
            <OnboardingModal />
            <InstallPrompt />
            <PriceAlertWatcher />
            <PaperTpSlWatcher />
            <PreferencesSync />
          </ToastProvider>
        </AuthProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
