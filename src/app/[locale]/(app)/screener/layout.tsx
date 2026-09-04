"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScanCountdown } from "@/components/screener/ScanCountdown";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import {
  SCENARIO_KINDS,
  TRAP_KINDS,
  TONE_CLASSES,
  IGNITION_TONE,
  scenarioVars,
} from "@/components/screener/scenario-ui";

/**
 * 主扫描表与警报卡片的公共外壳：标题、倒计时、刷新、图例、以及两个子页的
 * 切换。
 *
 * 为什么用真实路由而不是本地 state 切 tab：两个视图回答的是不同问题
 * （「有哪些币值得看」vs「现在有哪些活着的信号」），值得各自有地址——
 * 可收藏、可分享、浏览器后退能用。
 *
 * 数据只取一次：两个子页各自调 useScannerData，但 react-query 按 queryKey
 * 去重，实际只有一个请求。这里之所以也调一次，是因为倒计时与刷新按钮
 * 需要 lastUpdated / refetch。
 *
 * 错误态放在外壳而不是各子页：扫描挂了的话两个视图都没有东西可显示，
 * 放在这里少一份重复，也保证两边的报错长得一模一样。
 */
export default function ScreenerLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("screener");
  const tCalc = useTranslations("calculator");
  const locale = useLocale();
  const pathname = usePathname();
  const { cards, error, isRefreshing, lastUpdated, refetch } = useScannerData();

  const tabs = [
    { href: `/${locale}/screener`, label: t("tabs.table"), badge: null as number | null },
    { href: `/${locale}/screener/alerts`, label: t("tabs.cards"), badge: cards.length },
  ];

  return (
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-text-primary">
            {t("title")}
          </h1>
          <p className="text-[11px] tracking-wider text-text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 报错时不显示倒计时——那会是一个冻在 00:00 的假进度 */}
          {!error && <ScanCountdown lastUpdated={lastUpdated} />}
          <Button variant="outline" size="sm" onClick={refetch} disabled={isRefreshing}>
            {t("refresh_now")}
          </Button>
        </div>
      </div>

      {/* 下划线 tab 靠 -mb-px 压在 nav 的底线上；横向滚动包在内层 div 上而
          不是 nav 本身，否则那 1px 的负外边距会在滚动容器里触发一条竖向
          滚动条。en-US / ms-MY 文案在 375px 下放不下时横向滚，不许折行——
          折行会把下划线 tab 撑成两层。 */}
      <nav className="mb-4 border-b border-border-default">
        <div className="custom-scrollbar -mb-px flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            // 精确匹配而不是 startsWith：/screener 是 /screener/alerts 的前缀，
            // 用 startsWith 会让两个 tab 在卡片页上同时高亮。
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors lg:min-h-0",
                  active
                    ? "border-gold text-gold"
                    : "border-transparent text-text-secondary hover:text-text-primary"
                )}
              >
                {tab.label}
                {tab.badge !== null && tab.badge > 0 && (
                  <span className="tnum ml-1.5 rounded-sm bg-gold/15 px-1 py-px text-[11px] font-semibold text-gold lg:text-[10px]">
                    {tab.badge}
                  </span>
                )}
              </Link>
            );
          })}
          <Link
            href={`/${locale}/tools/position-size`}
            className="ml-auto inline-flex min-h-[44px] items-center whitespace-nowrap px-3 py-2 text-sm text-text-secondary transition-colors hover:text-gold lg:min-h-0"
          >
            {tCalc("title")} →
          </Link>
        </div>
      </nav>

      <details className="mb-4 rounded-lg panel">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-text-primary">
          {t("guide.title")}
        </summary>
        <div className="space-y-2.5 border-t border-border-default px-4 py-3 text-xs leading-relaxed text-text-secondary">
          <div>
            <ul className="space-y-1">
              {/* 点火排在六场景之前：选币口径改成「最安静」之后，警报栏里
                  绝大多数是点火卡（安静的币判不出场景），把最常见的那一类
                  排在最后面会让这张速查表读起来跟实际看到的东西对不上。 */}
              {(["up", "down"] as const).map((dir) => (
                <li key={dir} className="flex items-baseline gap-1.5">
                  <span className={cn("inline-flex items-center gap-1 font-medium", IGNITION_TONE.text)}>
                    <Icon name="bolt" className="h-3 w-3" />
                    {t(`ignition.${dir}.name`)}
                  </span>
                  <span>— {t(`ignition.${dir}.action`)}</span>
                </li>
              ))}
              {SCENARIO_KINDS.map((kind) => (
                <li key={kind} className="flex items-baseline gap-1.5">
                  <span className={cn("inline-flex items-center gap-1 font-medium", TONE_CLASSES[kind].text)}>
                    {TRAP_KINDS.has(kind) && <Icon name="alert" className="h-3 w-3" />}
                    {t(`scenarios.${kind}.name`, scenarioVars())}
                  </span>
                  <span>— {t(`scenarios.${kind}.action`, scenarioVars())}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      {error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-secondary">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
