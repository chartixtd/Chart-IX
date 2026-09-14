/**
 * DIRECTION CONTRACT — 「我的主页」（第三版）
 *
 * THESIS: 这一页回答一个人打开 app 时脑子里的四个问题，按那个顺序排：
 *   **我现在有多少** → **现在有什么值得看** → **我盯着的那几个怎么样了** →
 *   **我学到哪了** → **昨天发生了什么**。上一版是一张满幅抬头加四个 Bento
 *   盒子（继续学习 / 自选 / 最新视频 / 最新文章 / 成就墙），盒子里装的是
 *   「我们还有这些东西」，不是「你现在该看什么」。
 *
 * FORM: 整页没有卡片盒子。抬头是一个数 + 一行刻度 + 两枚按钮；其余四区
 *   一律是列表——信号、自选、早报都是按时间或优先级读的流水，切成网格会
 *   强迫读者在格子之间跳读。唯一的「面」是学习区的两张缩略图，因为一门课
 *   长什么样，图比字说得清楚。
 *
 * DENSITY: 这是 Operate 面。零装饰动效、零 backdrop-filter、金只出现在
 *   四处：唯一的实心 CTA、区块里的链接、涨跌之外的强调数字、信号行左边那道
 *   场景基调色的竖线（那是标注不是装饰）。抬头不再挂环境光与发丝栅格——
 *   它们在上一版里把首屏吃掉了一半，而这一页要在一屏里说完五件事。
 *
 * 拿掉了什么、为什么：
 *   - **对账台账**（成交 + 成就混排）→ 抬头那枚 Orders 按钮直接去 /orders，
 *     那一页就是完整的台账。主页放一个截断到 8 行的副本没有意义。
 *   - **最新视频 / 最新文章两个盒子** → 学习区与早报区取代它们，且说的是
 *     「你的进度」与「今天的事」，不是「库里最新的四条」。
 *   - **成就墙** → 参考图里没有。`useAchievements` 保留着没删，想加回来
 *     是一行的事。
 *   - **分享卡** → 跟着模拟盘的对账区一起下线。ShareCardModal 组件保留。
 *
 * 每一区自己拿自己的数据、自己管自己的骨架与空态（见 components/dashboard/）。
 * 这一页因此只剩构图。
 */
"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { AccountHeader } from "@/components/dashboard/AccountHeader";
import { SignalsSection } from "@/components/dashboard/SignalsSection";
import { WatchlistSection } from "@/components/dashboard/WatchlistSection";
import { LearningSection } from "@/components/dashboard/LearningSection";
import { BriefingSection } from "@/components/dashboard/BriefingSection";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  // 风险声明全站只有一句，复用首页那一条，不在这个命名空间里再写一份
  const tHome = useTranslations("home");
  const locale = useLocale();
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="mx-auto max-w-page px-6 py-10 lg:py-14">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-[3.25rem] w-56" />
        <Skeleton className="mt-3 h-4 w-72" />
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
        <Skeleton className="mt-12 h-40 w-full" />
      </div>
    );
  }

  if (!auth.userId) {
    return (
      <div className="mx-auto max-w-page px-6 py-10 lg:py-14">
        <EmptyState
          title={t("please_login")}
          description={t("please_login_desc")}
          action={
            <Link
              href={`/${locale}/login`}
              className="inline-flex h-11 items-center rounded-sm border border-gold/50 px-6 text-xs font-medium uppercase tracking-[0.14em] text-gold transition-colors hover:border-gold"
            >
              {t("go_login")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-6 pb-10 pt-10 lg:pt-14">
      <AccountHeader />

      {/*
        桌面不是把手机版拉宽——1280px 宽的单列会让按钮撑满半屏、信号行中间
        空出一大片、行情曲线拉成一条 900px 的平线。

        桌面是一张 2×2 的非对称网格（1.55fr / 1fr），自动落位正好是：
            信号 | 自选行情
            学习 | 早报
        左栏是「要你做决定的」，右栏是「扫一眼的」；两栏各自的行高由内容定，
        同一行的两个区块标题对齐。手机上它退回单列，顺序不变。
      */}
      <div
        className={cn(
          "mt-10 flex flex-col gap-10",
          "lg:mt-14 lg:grid lg:grid-cols-[1.55fr_1fr] lg:items-start lg:gap-x-14 lg:gap-y-14"
        )}
      >
        <SignalsSection />
        <WatchlistSection />
        <LearningSection />
        <BriefingSection />
      </div>

      {/* 风险声明压在最后，用 text-muted（4.79:1，AA 的下限）。
          不要再调暗——它是必须读得懂的文字，不是装饰 */}
      <p className="mt-12 border-t border-border-default pt-5 text-[11px] leading-relaxed text-text-muted">
        {tHome("risk_caption")}
      </p>
    </div>
  );
}
