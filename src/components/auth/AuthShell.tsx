"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AuraField } from "@/components/motion/AuraField";
import { GoldChart } from "@/components/motion/GoldChart";

/**
 * 认证页的分栏外壳：左侧是品牌铭牌（真实行情曲线 + 首页标题），右侧是表单。
 * 手机上只留表单，铭牌收成顶部一行品牌。
 *
 * 表单区没有卡片——留白、发丝线与底线输入框承担全部结构。
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const locale = useLocale();
  const tHome = useTranslations("home");

  return (
    <div className="grid min-h-[calc(100dvh-72px)] lg:grid-cols-12">
      {/* 品牌铭牌 */}
      <aside className="hero-ground grain relative hidden overflow-hidden border-r border-border-default lg:col-span-6 lg:flex lg:flex-col xl:col-span-7">
        <AuraField />
        <div aria-hidden className="ruled-grid absolute inset-0 opacity-70" />
        <div className="relative flex flex-1 flex-col justify-between p-12 xl:p-16">
          <Link href={`/${locale}`} className="flex w-fit items-center gap-3" aria-label="Chart-IX">
            <Image src="/logo.png" alt="" width={240} height={160} className="h-9 w-auto" />
            <span className="font-display text-base font-medium tracking-[0.02em] text-text-primary">
              Chart<span className="text-gold">-IX</span>
            </span>
          </Link>

          <div className="my-12 h-[300px] xl:h-[360px]">
            <GoldChart symbol="BTC-USDT" interval="4h" limit={120} height={280} />
          </div>

          <div>
            <p className="section-mark eyebrow-gold">{tHome("hero_eyebrow")}</p>
            <h2 className="display mt-6 max-w-lg text-display-lg">{tHome("hero_title")}</h2>
          </div>
        </div>
      </aside>

      {/* 表单 */}
      <div className="flex items-center justify-center px-6 py-14 lg:col-span-6 xl:col-span-5">
        <div className="w-full max-w-sm">
          <Link href={`/${locale}`} className="mb-12 flex items-center gap-2.5 lg:hidden" aria-label="Chart-IX">
            <Image src="/logo.png" alt="" width={240} height={160} priority className="h-8 w-auto" />
            <span className="font-display text-sm font-medium tracking-[0.02em] text-text-primary">
              Chart<span className="text-gold">-IX</span>
            </span>
          </Link>

          <h1 className="display text-display-md">{title}</h1>
          {subtitle && <p className="mt-4 text-sm leading-relaxed text-text-secondary">{subtitle}</p>}
          <div className="hairline-gold mt-8 w-12" />

          <div className="mt-10">{children}</div>

          {footer && <div className="mt-10 border-t border-border-default pt-6 text-sm text-text-secondary">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

/** 认证页里的金色文字链接 */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="link-underline font-medium text-gold">
      {children}
    </Link>
  );
}
