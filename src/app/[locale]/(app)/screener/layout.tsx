"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScanCountdown } from "@/components/screener/ScanCountdown";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

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

      {/* 这里原本有一张「场景速查表」（可折叠，列出点火 + 全部八个场景各自的
          名称与操作建议）。**拿掉了，而且它当时已经在说假话**：卡片场景收敛到
          a2/b2/a3/b3、点火不再出卡之后（见 factors/scenario.ts 的
          ENABLED_SCENARIO_KINDS 与 cards.ts 的 IGNITION_CARDS_ENABLED），
          速查表照旧列着 a1/a4/b1/b4/陷阱/点火——把一批**根本不会出现**的卡片
          当成使用说明摆在页面顶上。

          日后若要恢复，别再写成「把所有 kind 遍历一遍」：那种写法跟实际会出
          什么卡是脱钩的，收敛一次就假一次。要么直接从 ENABLED_SCENARIO_KINDS
          生成，要么不要。 */}

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
