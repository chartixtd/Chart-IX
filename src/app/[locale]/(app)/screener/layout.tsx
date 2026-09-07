/**
 * DIRECTION CONTRACT — 扫描器（Ink & Gilt 版）
 *
 * THESIS: 这一页此前是一行 22px 标题、一行 12px 倒计时、一条下划线 tab、
 *   一张灰卡里塞着四个过滤项，然后是表格——四样东西同一个音量，读起来是
 *   「一个带标题的控件板」。这一版把它做成一个**时刻**：整页只有一个主角，
 *   是「现在有几个活着的信号」这个数；它旁边是一枚十五分钟的扫描表盘。
 *   其余一切（候选池、门槛、表格、卡片）退到它下面，按 Operate 面的纪律排。
 *
 * OWN-WORLD: 与仪表盘同一套抬头语法——满幅墨底 + 环境光 + 发丝栅格，巨型
 *   轻字重数字（clamp 到 8rem），右侧压一枚**真实周期**的金色表盘（ScanPulse：
 *   十五道分钟刻度、一条按已过时间生长的金弧、末端一枚「现在」金点）。
 *   数据带用发丝线分栏（与 StatRow 同源），不再用卡片框。
 *
 * FORM: 抬头是 Persuade 强度（8 / 5 / 4），抬头以下是 Operate（4 / 2 / 7）：
 *   表格与卡片零入场动效、零 backdrop-filter，金只出现在选中态、表头发丝线
 *   与关键数字上。
 *
 * STORY: 用户理解这是一台按固定节奏工作的仪器，不是一个随手刷的列表；
 *   相信它给出的每个数都有出处（候选池多大、门槛是什么、这一轮算于何时）；
 *   行动是切到警报卡、或直接在表格里做多 / 做空。
 *
 * FIRST VIEWPORT: 金线微标签「扫描器」+ 本轮计算时间 → 巨型「活跃信号」数
 *   与扫描表盘并置 → 两个子页的下划线切换。
 *
 * 两个子页仍是真实路由而不是本地 state：它们回答的是不同问题（「有哪些币
 * 值得看」vs「现在有哪些活着的信号」），值得各自有地址。数据只取一次——
 * react-query 按 queryKey 去重。错误态放在这里，两个子页报错长得一模一样。
 */
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScanPulse } from "@/components/screener/ScanPulse";
import { AuraField } from "@/components/motion/AuraField";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export default function ScreenerLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("screener");
  const tCalc = useTranslations("calculator");
  const locale = useLocale();
  const pathname = usePathname();
  const { rows, cards, error, isLoading, isRefreshing, lastUpdated, refetch } = useScannerData();

  // 抬头那个数只算**活着的**信号。已结束的灰卡是为了对照推送留下的上下文，
  // 不是信号；把它们计进去会让「活跃信号 5」和列表里只剩两张亮卡对不上。
  const liveCount = useMemo(() => cards.filter((c) => !c.expired).length, [cards]);

  const computedAtLabel = useMemo(() => {
    if (lastUpdated <= 0) return null;
    try {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(lastUpdated));
    } catch {
      return null;
    }
  }, [lastUpdated, locale]);

  const tabs = [
    { href: `/${locale}/screener`, label: t("tabs.table"), badge: null as number | null },
    { href: `/${locale}/screener/alerts`, label: t("tabs.cards"), badge: liveCount },
  ];

  return (
    <div>
      {/* ── 抬头 ─────────────────────────────────────────────────────────
          满幅墨底 + 环境光 + 发丝栅格。左边一个数，右边一枚表盘，别无他物。 */}
      <section className="hero-ground grain relative overflow-hidden">
        <AuraField />
        <div aria-hidden className="ruled-grid pointer-events-none absolute inset-0 opacity-60" />

        <div className="relative mx-auto max-w-[110rem] px-4 pt-10 lg:px-6 lg:pt-14">
          {/* items-center 而不是 items-baseline：h1 是个 flex 容器，它的基线取自第一个
              子项——那段 1px 的金线——于是右边那行会比标题高出 3px。两者都是 11px
              的微标签，按中线对齐才是齐的。 */}
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
            <h1 className="section-mark eyebrow-gold animate-rise-in">{t("title")}</h1>
            {/* text-secondary 而不是 eyebrow 默认的 text-muted：这行压在环境光与
                颗粒纹理上，muted 那 4.79:1 的余量在这里实测读不出来。 */}
            {computedAtLabel && (
              <p className="eyebrow animate-rise-in tabular-nums text-text-secondary [animation-delay:80ms]">
                {t("hero.computed_at", { time: computedAtLabel })}
              </p>
            )}
          </div>

          <div className="mt-8 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6 lg:mt-12 lg:gap-16">
            <div className="min-w-0 animate-rise-in [animation-delay:80ms]">
              {error ? (
                <div className="display text-3xl text-text-muted md:text-4xl">{t("error")}</div>
              ) : isLoading ? (
                <Skeleton className="h-[clamp(4rem,12vw,8rem)] w-[clamp(4rem,12vw,8rem)]" />
              ) : (
                <div className="numeral text-[clamp(4rem,12vw,8rem)] leading-[0.9]">{liveCount}</div>
              )}
              <p className="eyebrow mt-5 text-text-secondary">{t("hero.live_signals")}</p>
              {!error && !isLoading && (
                <p className="mt-2 font-mono text-xs tabular-nums text-text-muted">
                  {t("candidate_count", { count: rows.length })}
                </p>
              )}
            </div>

            <div className="animate-blur-in [animation-delay:160ms]">
              <ScanPulse
                lastUpdated={error ? 0 : lastUpdated}
                isRefreshing={isRefreshing}
                disabled={!!error && isRefreshing}
                onRefresh={refetch}
              />
            </div>
          </div>
        </div>

        {/* 下划线 tab 靠 -mb-px 压在这条底线上。底线画在这个满幅包裹层上而不是
            section 上：section 是 overflow-hidden，tab 往下溢出的那 1px 会被裁掉。
            横向滚动包在 nav 上：en-US / ms-MY 文案在 375px 下放不下时横向滚，
            不许折行——折行会把下划线 tab 撑成两层。 */}
        <div className="relative mt-10 border-b border-border-default lg:mt-14">
          <div className="mx-auto max-w-[110rem] px-4 lg:px-6">
            <nav className="custom-scrollbar -mb-px flex items-center gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                // 精确匹配而不是 startsWith：/screener 是 /screener/alerts 的前缀，
                // 用 startsWith 会让两个 tab 在卡片页上同时高亮。
                const active = pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-[44px] items-center whitespace-nowrap border-b px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors lg:min-h-0 lg:py-3.5",
                      active ? "border-gold text-gold" : "border-transparent text-text-muted hover:text-text-primary"
                    )}
                  >
                    {tab.label}
                    {tab.badge !== null && tab.badge > 0 && (
                      <span className="ml-2 font-mono text-[11px] tabular-nums text-gold/80">{tab.badge}</span>
                    )}
                  </Link>
                );
              })}
              <Link
                href={`/${locale}/tools/position-size`}
                className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-gold lg:min-h-0 lg:py-3.5"
              >
                {tCalc("title")}
                <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </Link>
            </nav>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[110rem] px-4 py-10 lg:px-6 lg:py-14">
        {error ? (
          <EmptyState
            icon={<Icon name="alert" className="h-6 w-6" />}
            title={t("error")}
            action={
              <Button variant="outline" size="sm" onClick={refetch} disabled={isRefreshing}>
                {t("retry")}
              </Button>
            }
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
