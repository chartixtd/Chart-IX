"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { PriceAlertBell } from "@/components/alerts/PriceAlertBell";

export function MobileHeader() {
  const locale = useLocale();
  const auth = useAuth();

  return (
    // 状态栏样式是 black-translucent，内容会顶到状态栏下方，
    // 所以必须吃掉 safe-area-inset-top
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-primary/85 pt-safe-t backdrop-blur-md lg:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        <Link href={auth.userId ? `/${locale}/dashboard` : `/${locale}`}>
          <Image src="/logo.png" alt="Chart-IX" width={240} height={160} priority className="h-7 w-auto" />
        </Link>
        {/* 语言切换挪进 /more 的设置——低频操作不该占手机上最贵的横向空间 */}
        <PriceAlertBell />
      </div>
    </header>
  );
}
