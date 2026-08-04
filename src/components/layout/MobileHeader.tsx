"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { PriceAlertBell } from "@/components/alerts/PriceAlertBell";
import { Button } from "@/components/ui/Button";

export function MobileHeader() {
  const locale = useLocale();
  const auth = useAuth();
  const t = useTranslations("nav");

  return (
    // 状态栏样式是 black-translucent，内容会顶到状态栏下方，
    // 所以必须吃掉 safe-area-inset-top
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-primary/85 pt-safe-t backdrop-blur-md lg:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        <Link href={auth.userId ? `/${locale}/dashboard` : `/${locale}`}>
          <Image src="/logo.png" alt="Chart-IX" width={240} height={160} priority className="h-7 w-auto" />
        </Link>
        {/* 语言切换挪进 /more 的设置——低频操作不该占手机上最贵的横向空间 */}
        {!auth.loading && !auth.userId ? (
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">{t("sign_in")}</Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm">{t("sign_up")}</Button>
            </Link>
          </div>
        ) : (
          <PriceAlertBell />
        )}
      </div>
    </header>
  );
}
