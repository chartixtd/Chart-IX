"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { shouldShowBackButton, resolveBackTarget } from "@/lib/nav/tabs";
import { recordPath, hasInAppHistory, recordSyntheticBack } from "@/lib/nav/history";

export function MobileHeader() {
  const locale = useLocale();
  const auth = useAuth();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname() ?? "";
  const router = useRouter();

  // 每次路径变化都记一笔，供返回按钮判断能不能安全地 back()。
  // 记录器是模块级的，跨路由组重挂载依然活着——判断因此不会被
  // (app)/(static) 之间的跳转打断。
  useEffect(() => {
    if (!pathname) return;
    recordPath(pathname);
  }, [pathname]);

  const showBack = shouldShowBackButton(pathname, locale);

  const handleBack = () => {
    if (hasInAppHistory()) {
      router.back();
      return;
    }
    // 外部链接直入 / PWA 冷启动：没有站内上一页可退，退到该页所属的上级，
    // 而不是 back() 把用户踢出站点
    const target = resolveBackTarget(pathname, locale);
    recordSyntheticBack(target);
    router.push(target);
  };

  return (
    // 状态栏样式是 black-translucent，内容会顶到状态栏下方，
    // 所以必须吃掉 safe-area-inset-top。
    // 底色是不透明的：这个 header 挂在所有 (app) 路由上，包括交易页——
    // 半透明 + backdrop-blur 压在每 tick 重绘的 K 线画布上，正是 DESIGN.md
    // 点名的低端安卓掉帧场景。玻璃感由边框线承担，不靠 blur。
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-primary pt-safe-t lg:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        {showBack ? (
          // -ml-2 px-2 让文字仍与原 logo 左缘对齐，同时把命中区向左右各撑开
          <button
            type="button"
            onClick={handleBack}
            className="-ml-2 flex min-h-[44px] items-center gap-1 px-2 text-sm text-text-secondary transition-colors active:text-text-primary"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {tCommon("back")}
          </button>
        ) : (
          <Link href={auth.userId ? `/${locale}/dashboard` : `/${locale}`}>
            <Image src="/logo.png" alt="Chart-IX" width={240} height={160} priority className="h-7 w-auto" />
          </Link>
        )}
        {/* 价格提醒暂时隐藏（组件与路由都还在，见
            docs/superpowers/specs/2026-08-10-mobile-nav-cleanup-design.md）；
            语言切换挪进 /more 的设置——低频操作不该占手机上最贵的横向空间。
            两者都不在，所以已登录时右侧就是空的 */}
        {!auth.loading && !auth.userId ? (
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">{t("sign_in")}</Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm">{t("sign_up")}</Button>
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}
