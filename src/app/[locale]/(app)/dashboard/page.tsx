/**
 * DIRECTION CONTRACT — 「我的主页」（Ink & Gilt 版）
 *
 * THESIS: 这一页是登录后的第一眼，值得当作一个**时刻**来设计，而不是一个
 *   带标题的控件板。上一版只是把字重换轻了，构图没动——一条问候、一条金线、
 *   一串 text-lg 的小标题往下排，读起来仍然是「四个盒子」。这一版把权益数字
 *   做成满幅抬头里的主角，其余内容退到它下面。
 *
 * OWN-WORLD: 满幅墨底 + 环境光 + 发丝栅格的抬头区，巨型轻字重权益数字
 *   （clamp 到 5.5rem），右侧压一条**该用户自选标的的真实行情曲线**——与
 *   首页 GoldChart 同一个组件，让营销面与产品面是同一个世界而不是两套皮。
 *   刻度式数据带（StatRow）取代原来的四列 dl，区块标题升到展示级。
 *
 * FORM: 内容性质决定形态，这条不变——
 *   - 时间序台账（成交 + 成就）**保持台账**：按时间读的流水，切成网格会
 *     强迫读者在格子间跳读。
 *   - 概览类内容（继续学习 / 自选行情 / 最新内容 / 成就墙）用**非对称 Bento**：
 *     彼此独立、没有先后关系，网格比上下堆叠更快找到目标。
 *
 * STORY: 用户理解这是他的账户对账单而不是一块小组件板；相信他的状况
 *   （权益、真实交易活动、学习进度）被精确记录着；行动是继续交易、继续学习，
 *   或点开某一条具体记录。
 *
 * FIRST VIEWPORT: 满幅抬头（问候微标签 + 对账周期 → 实盘/模拟下划线切换 +
 *   自选行情曲线 → 巨型权益数字 → 刻度式数据带）。整屏只有一个主角。
 */
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFavoritesStore } from "@/stores/favorites";
import { useMarketStore } from "@/stores/market";
import { usePaperAccount } from "@/hooks/usePaperTrading";
import { useSpotBalances } from "@/hooks/useTradingAccount";
import { useAchievements } from "@/hooks/useAchievements";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import {
  useContinueWatching, useLatestVideos, useLatestArticles, useDashboardOrders,
} from "@/hooks/useDashboardData";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading, StatRow, SegmentTabs } from "@/components/ui/Section";
import { AuraField } from "@/components/motion/AuraField";
import { GoldChart } from "@/components/motion/GoldChart";
import { ShareCardModal } from "@/components/dashboard/ShareCardModal";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Locale, Order } from "@/types";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * 成就图标：数据库里存的是 emoji（012_quizzes_achievements.sql 的默认值），
 * 但 emoji 跨平台字形不一致、跟不了 currentColor——渲染前映射成站内
 * 线性图标。库里出现新 emoji 时回落到奖杯，不至于渲染出豆腐块。
 */
const ACHIEVEMENT_ICONS: Record<string, IconName> = {
  "\u{1F3C6}": "trophy", // 🏆
  "\u{1F331}": "seedling", // 🌱
  "\u{1F4DA}": "book", // 📚
  "\u{1F393}": "graduation", // 🎓
  "\u{1F4C8}": "candles", // 📈
  "✅": "check", // ✅
};

function achievementIcon(emoji: string): IconName {
  return ACHIEVEMENT_ICONS[emoji?.trim()] ?? "trophy";
}

type LedgerEntry =
  | { kind: "trade"; id: string; date: string; order: Order }
  | { kind: "achievement"; id: string; date: string; title: string; icon: string };

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const auth = useAuth();
  const favorites = useFavoritesStore((s) => s.favorites);

  const [shareOpen, setShareOpen] = useState(false);
  const [summaryMode, setSummaryMode] = useState<"live" | "paper">("live");

  const { data: paperData, isLoading: paperLoading } = usePaperAccount(!!auth.userId);
  const { data: spotBalances, isLoading: spotLoading, error: spotError } = useSpotBalances(!!auth.userId);
  const { data: achievements } = useAchievements(auth.userId);
  const { data: continueWatching, isPending: continueWatchingPending } = useContinueWatching(auth.userId);
  const { data: latestVideos, isPending: latestVideosPending } = useLatestVideos(!!auth.userId);
  const { data: latestArticles, isPending: latestArticlesPending } = useLatestArticles(!!auth.userId);
  const { data: orders, isPending: ordersPending } = useDashboardOrders(auth.userId);

  // 现货全部资产按最新价折算 USDT，用于"完整余额"，而不只是可用 USDT 现金
  const { data: spotTickers } = useQuery({
    queryKey: ["dashboard", "spot-tickers"],
    queryFn: async () => {
      const res = await fetch("/api/bingx/market/ticker");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Request failed");
      return json.data as { symbol: string; lastPrice: string }[];
    },
    enabled: !!auth.userId,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // 合约账户权益（保证金 + 未实现盈亏），与现货资产合并才是完整余额
  const { data: futuresBalance } = useQuery({
    queryKey: ["dashboard", "futures-balance"],
    queryFn: async () => {
      const res = await fetch("/api/bingx/futures/positions?type=balance");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Request failed");
      return json.data as { equity: string } | null;
    },
    enabled: !!auth.userId,
    staleTime: 15_000,
    retry: false,
  });
  useBingXWebSocket(favorites.slice(0, 10));

  // 合约权益 = 可用余额 + Σ(占用保证金 + 未实现盈亏)
  const paperPositionsEquity = (paperData?.positions ?? []).reduce((sum, p) => {
    const ticker = useMarketStore.getState().tickers[p.symbol];
    const entry = parseFloat(String(p.entry_price));
    const qty = parseFloat(String(p.quantity));
    const margin = parseFloat(String(p.margin));
    const markPrice = ticker ? Number(ticker.lastPrice) : entry;
    const uPnl = p.side === "long" ? (markPrice - entry) * qty : (entry - markPrice) * qty;
    return sum + margin + uPnl;
  }, 0);
  const paperTotalValue = (paperData?.account.balance_usdt ?? 0) + paperPositionsEquity;
  const paperPnl = paperData ? paperTotalValue - 10000 : 0;
  const paperPnlPct = paperData ? (paperPnl / 10000) * 100 : 0;

  const liveUsdtBalance = parseFloat(spotBalances?.find((b) => b.asset === "USDT")?.free ?? "0") || 0;
  const liveHoldingsCount = (spotBalances ?? []).filter((b) => parseFloat(b.free) + parseFloat(b.locked) > 0).length;
  const liveNotConnected = !spotLoading && !!spotError;

  // 现货总资产（按最新价折算全部持仓，非仅可用 USDT 现金）+ 合约账户权益 = 完整余额
  const spotPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    (spotTickers ?? []).forEach((tk) => map.set(tk.symbol, parseFloat(tk.lastPrice) || 0));
    return map;
  }, [spotTickers]);

  const spotTotalValue = (spotBalances ?? []).reduce((sum, b) => {
    const qty = (parseFloat(b.free) || 0) + (parseFloat(b.locked) || 0);
    if (qty <= 0) return sum;
    if (b.asset === "USDT") return sum + qty;
    const price = spotPriceMap.get(`${b.asset}-USDT`);
    return price ? sum + qty * price : sum;
  }, 0);
  const futuresEquity = parseFloat(futuresBalance?.equity ?? "0") || 0;
  const liveTotalValue = spotTotalValue + futuresEquity;

  const filledOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => o.status === "filled" || o.status === "partially_filled");
  }, [orders]);

  const tradeStats = useMemo(() => {
    const filled = filledOrders;
    const totalTrades = filled.length;
    const totalVolume = filled.reduce((sum, o) => sum + (o.total_value ?? 0), 0);
    const totalFees = filled.reduce((sum, o) => sum + (o.fee ?? 0), 0);
    const sellTotal = filled.filter((o) => o.side === "sell").reduce((sum, o) => sum + (o.total_value ?? 0), 0);
    const buyTotal = filled.filter((o) => o.side === "buy").reduce((sum, o) => sum + (o.total_value ?? 0), 0);
    const netPnl = sellTotal - buyTotal - totalFees;
    const pairCounts: Record<string, number> = {};
    filled.forEach((o) => {
      pairCounts[o.symbol] = (pairCounts[o.symbol] ?? 0) + 1;
    });
    let mostTradedPair = "";
    let maxCount = 0;
    for (const [pair, count] of Object.entries(pairCounts)) {
      if (count > maxCount) { maxCount = count; mostTradedPair = pair; }
    }
    return { totalTrades, totalVolume, totalFees, netPnl, mostTradedPair, maxCount };
  }, [filledOrders]);

  // 统一台账：实盘成交 + 成就解锁，按时间倒序合并，只取最近一段
  const ledger = useMemo<LedgerEntry[]>(() => {
    const tradeEntries: LedgerEntry[] = filledOrders.map((o) => ({
      kind: "trade",
      id: `trade-${o.id}`,
      date: o.created_at,
      order: o,
    }));
    const achievementEntries: LedgerEntry[] = (achievements ?? [])
      .filter((a) => a.earned && a.earnedAt)
      .map((a) => ({
        kind: "achievement",
        id: `ach-${a.key}`,
        date: a.earnedAt as string,
        title: a.title[locale] ?? a.title["en-US"],
        icon: a.icon,
      }));
    return [...tradeEntries, ...achievementEntries]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);
  }, [filledOrders, achievements, locale]);

  const statementPeriod = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(new Date());
    } catch {
      return "";
    }
  }, [locale]);

  if (auth.loading) {
    return (
      <div className="mx-auto max-w-page px-6 py-12">
        <Skeleton className="h-8 w-64" />
        <div className="mt-10 space-y-6">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (!auth.userId) {
    return (
      <div className="mx-auto max-w-page px-6 py-16">
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-gold">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 018 0v3" />
            </svg>
          }
          title={t("please_login")}
          description={t("please_login_desc")}
          action={
            <Link href={`/${locale}/login`}>
              <Badge variant="gold" size="md">{t("go_login")}</Badge>
            </Link>
          }
        />
      </div>
    );
  }

  const displayName = auth.displayName || auth.email?.split("@")[0];

  return (
    <div>
      {/* ── 对账单抬头 ──────────────────────────────────────────────────
          登录后的第一眼。满幅墨底 + 环境光 + 发丝栅格，左侧巨型权益数字，
          右侧压一条该用户自选标的的真实行情曲线——跟首页同一个组件，
          让「营销面」和「产品面」是同一个世界而不是两套皮。 */}
      <section className="hero-ground grain relative overflow-hidden border-b border-border-default">
        <AuraField />
        <div aria-hidden className="ruled-grid pointer-events-none absolute inset-0 opacity-60" />

        <div className="relative mx-auto max-w-page px-6 pb-12 pt-12 lg:pb-16 lg:pt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <p className="section-mark eyebrow-gold">
              {t("welcome")}{displayName ? `, ${displayName}` : ""}
            </p>
            {statementPeriod && (
              <p className="eyebrow">{t("statement_period", { period: statementPeriod })}</p>
            )}
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-7">
              <SegmentTabs
                className="border-b border-border-default"
                value={summaryMode}
                onChange={(k) => setSummaryMode(k as "live" | "paper")}
                options={[
                  { key: "live", label: t("live_account") },
                  { key: "paper", label: t("paper_tab") },
                ]}
              />
            </div>
            {/* 自选第一支的实时曲线。没有自选时退回 BTC——空着一半版面比
                显示一个默认标的更糟。 */}
            <div className="hidden lg:col-span-5 lg:block">
              <div className="h-[136px]">
                <GoldChart
                  symbol={favorites[0] ?? "BTC-USDT"}
                  interval="1h"
                  limit={72}
                  height={136}
                />
              </div>
            </div>
          </div>

        {summaryMode === "live" ? (
          <>
            <div className="mt-12 flex flex-wrap items-end justify-between gap-6">
              {spotLoading ? (
                <Skeleton className="h-14 w-64" />
              ) : liveNotConnected ? (
                <div>
                  <div className="display text-3xl text-text-muted md:text-4xl">
                    {t("not_connected")}
                  </div>
                  <Link href={`/${locale}/settings/api-keys`} className="link-underline mt-3 inline-block text-[11px] font-medium uppercase tracking-[0.14em] text-gold">
                    {t("connect_api_cta")} →
                  </Link>
                </div>
              ) : (
                <div className="min-w-0">
                  {/* 六位数以上的权益在 375px 上会顶到边缘，所以字号走 clamp 的
                      下限而不是固定值，并允许断行兜底 */}
                  <div className="numeral break-words text-[clamp(2.75rem,9vw,5.5rem)] leading-[0.95]">
                    {formatPrice(liveTotalValue)}
                    <span className="ml-3 align-super font-sans text-[0.22em] font-medium uppercase tracking-[0.2em] text-text-muted">
                      USDT
                    </span>
                  </div>
                  <div className="mt-4 font-mono text-xs tabular-nums text-text-muted">
                    {t("full_balance_summary", { count: liveHoldingsCount })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Link href={`/${locale}/trade`} className="link-underline text-[11px] font-medium uppercase tracking-[0.14em] text-gold">
                  {t("enter_live_trade_cta")} →
                </Link>
              </div>
            </div>

            {/* 抬头只放余额：交易活动三项挪到台账上方，它们在那里是台账的
                上下文，摆在这里只是为了凑满第二行。 */}
            <StatRow
              className="mt-10"
              items={[
                { label: t("spot_asset_value"), value: formatPrice(spotTotalValue) },
                { label: t("futures_equity"), value: formatPrice(futuresEquity) },
                { label: t("spot_available_usdt"), value: formatPrice(liveUsdtBalance) },
                { label: t("holdings_count"), value: liveHoldingsCount },
              ]}
            />
          </>
        ) : (
          <>
            <div className="mt-12 flex flex-wrap items-end justify-between gap-6">
              {paperLoading ? (
                <Skeleton className="h-14 w-64" />
              ) : (
                <div className="min-w-0">
                  <div className="numeral break-words text-[clamp(2.75rem,9vw,5.5rem)] leading-[0.95]">
                    {formatPrice(paperTotalValue)}
                    <span className="ml-3 align-super font-sans text-[0.22em] font-medium uppercase tracking-[0.2em] text-text-muted">
                      USDT
                    </span>
                  </div>
                  <div className={cn("mt-4 font-mono text-xs tabular-nums", paperPnl >= 0 ? "text-success" : "text-danger")}>
                    {paperPnl >= 0 ? "+" : ""}{formatPrice(paperPnl)} ({formatPercent(paperPnlPct)}) {t("cumulative_suffix")}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                {paperData && (
                  <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                    </svg>
                    {t("share")}
                  </Button>
                )}
                <Link href={`/${locale}/trade`} className="link-underline text-[11px] font-medium uppercase tracking-[0.14em] text-gold">
                  {t("paper_cta")} →
                </Link>
              </div>
            </div>

            {/* Ruled sub-line items */}
            <StatRow
              className="mt-10"
              items={[
                { label: t("paper_balance"), value: formatPrice(paperData?.account.balance_usdt ?? 0) },
                {
                  label: t("cumulative_pnl"),
                  value: `${paperPnl >= 0 ? "+" : ""}${formatPrice(paperPnl)}`,
                  tone: paperPnl >= 0 ? "up" : "down",
                },
                {
                  label: t("cumulative_return"),
                  value: formatPercent(paperPnlPct),
                  tone: paperPnlPct >= 0 ? "up" : "down",
                },
                { label: t("holdings_quantity"), value: paperData?.positions.length ?? 0 },
              ]}
            />
          </>
        )}
        </div>
      </section>

      <div className="mx-auto max-w-page px-6 py-16 lg:py-24">
      {/* Unified ledger */}
      <section>
        <SectionHeading
          title={t("ledger_title")}
          action={
            <Link href={`/${locale}/orders`} className="link-underline text-[11px] font-medium uppercase tracking-[0.14em] text-gold">
              {t("view_all_orders_cta")} →
            </Link>
          }
        />

        {/* 这三项是台账的上下文：这段流水一共做了多大、净了多少、集中在哪个品种 */}
        <StatRow
          className="mt-10 sm:grid-cols-3"
          items={[
            { label: t("live_volume"), value: formatPrice(tradeStats.totalVolume) },
            {
              label: t("live_net"),
              value: `${tradeStats.netPnl >= 0 ? "+" : ""}${formatPrice(tradeStats.netPnl)}`,
              tone: tradeStats.netPnl >= 0 ? "up" : "down",
            },
            {
              label: t("most_traded_pair"),
              value: tradeStats.mostTradedPair
                ? `${tradeStats.mostTradedPair}${tradeStats.maxCount > 0 ? ` ×${tradeStats.maxCount}` : ""}`
                : "—",
            },
          ]}
        />

        {ordersPending ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : ledger.length === 0 ? (
          <p className="mt-5 border-y border-border-default py-6 text-center text-sm text-text-muted">
            {t("ledger_empty")}
          </p>
        ) : (
          <div className="mt-5 divide-y divide-border-default border-y border-border-default">
            {ledger.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} locale={locale} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* 继续学习 + 自选行情 —— Bento 起点。
          材质是 .ink（不透明墨面）而不是 .ink-glass：仪表盘是 Operate 面，
          DESIGN.md 明令零 backdrop-filter——手机上四块整宽玻璃在滚动时
          全程重算 blur(20px)。同一套边缘语言，只是不透明。 */}
      <section className="mt-24 grid gap-4 sm:grid-cols-2">
        <div className="ink min-w-0 rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-medium tracking-tight text-text-primary">{t("continue_learning_title")}</h2>
            {/* 纯箭头图标链接，视觉上很小；移动端补足到 44px 触控高度，桌面端不变 */}
            <Link href={`/${locale}/videos`} aria-label={t("continue_learning_cta")} className="inline-flex min-h-[44px] items-center px-1 text-text-muted hover:text-gold lg:min-h-0 lg:px-0"><Icon name="arrowRight" className="h-4 w-4" /></Link>
          </div>
          <div className="mt-4 border-t border-border-default/70">
            {continueWatchingPending ? (
              <Skeleton className="mt-4 h-16" />
            ) : !continueWatching || continueWatching.length === 0 ? (
              <div className="pt-4">
                <p className="text-xs text-text-muted">{t("continue_learning_empty")}</p>
                <Link href={`/${locale}/videos`} className="link-underline mt-3 inline-block text-[11px] font-medium uppercase tracking-[0.14em] text-gold">
                  {t("continue_learning_cta")} →
                </Link>
              </div>
            ) : (
              continueWatching.map((item) => {
                if (!item.video) return null;
                const pct = item.video.duration_seconds > 0
                  ? Math.min(100, Math.round((item.progress_seconds / item.video.duration_seconds) * 100))
                  : 0;
                return (
                  <Link
                    key={item.video_id}
                    href={`/${locale}/videos/${item.video_id}`}
                    className="group flex items-center justify-between gap-4 border-b border-border-default py-3 first:pt-4"
                  >
                    <span className="truncate text-sm text-text-secondary group-hover:text-gold">
                      {item.video.title[locale] ?? item.video.title["en-US"]}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="h-px w-16 overflow-hidden bg-border-strong">
                        <span className="block h-full bg-gold" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="font-mono text-xs tabular-nums text-text-muted">{pct}%</span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="ink min-w-0 rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-medium tracking-tight text-text-primary">{t("favorites_title")}</h2>
            <Link href={`/${locale}/trade`} aria-label={t("favorites_cta")} className="inline-flex min-h-[44px] items-center px-1 text-text-muted hover:text-gold lg:min-h-0 lg:px-0"><Icon name="arrowRight" className="h-4 w-4" /></Link>
          </div>
          <div className="mt-4 border-t border-border-default/70">
            {favorites.length === 0 ? (
              <div className="pt-4">
                <p className="text-xs text-text-muted">{t("favorites_empty")}</p>
                <Link href={`/${locale}/trade`} className="link-underline mt-3 inline-block text-[11px] font-medium uppercase tracking-[0.14em] text-gold">
                  {t("favorites_cta")} →
                </Link>
              </div>
            ) : (
              favorites.slice(0, 5).map((symbol) => (
                <FavoriteRow key={symbol} symbol={symbol} locale={locale} />
              ))
            )}
          </div>
        </div>
      </section>

      {/* 最新内容 */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="ink min-w-0 rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-medium tracking-tight text-text-primary">{t("latest_videos_title")}</h2>
            <Link href={`/${locale}/videos`} aria-label={t("latest_videos_title")} className="inline-flex min-h-[44px] items-center px-1 text-text-muted hover:text-gold lg:min-h-0 lg:px-0"><Icon name="arrowRight" className="h-4 w-4" /></Link>
          </div>
          <div className="mt-4 border-t border-border-default/70">
            {latestVideosPending ? (
              <Skeleton className="mt-4 h-24" />
            ) : !latestVideos || latestVideos.length === 0 ? (
              // 与左上两格同形的空态：空数组时这一格不能只剩标题和一条线
              <p className="pt-4 text-xs text-text-muted">{t("latest_videos_empty")}</p>
            ) : (
              latestVideos.map((video) => (
                <Link
                  key={video.id}
                  href={`/${locale}/videos/${video.id}`}
                  className="flex items-center gap-3 border-b border-border-default py-3 first:pt-4"
                >
                  <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                    {video.thumbnail_url && (
                      <Image
                        src={video.thumbnail_url}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="64px"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <span className="block min-w-0 flex-1 truncate text-sm text-text-secondary hover:text-gold">
                    {video.title[locale] ?? video.title["en-US"]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="ink min-w-0 rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-medium tracking-tight text-text-primary">{t("latest_articles_title")}</h2>
            <Link href={`/${locale}/articles`} aria-label={t("latest_articles_title")} className="inline-flex min-h-[44px] items-center px-1 text-text-muted hover:text-gold lg:min-h-0 lg:px-0"><Icon name="arrowRight" className="h-4 w-4" /></Link>
          </div>
          <div className="mt-4 border-t border-border-default/70">
            {latestArticlesPending ? (
              <Skeleton className="mt-4 h-24" />
            ) : !latestArticles || latestArticles.length === 0 ? (
              <p className="pt-4 text-xs text-text-muted">{t("latest_articles_empty")}</p>
            ) : (
              latestArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/${locale}/articles/${article.slug}`}
                  className="block border-b border-border-default py-3 first:pt-4"
                >
                  <span className="block min-w-0 flex-1 truncate text-sm text-text-secondary hover:text-gold">
                    {article.title[locale] ?? article.title["en-US"]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Achievements — restrained seal row, not a colored pill wall */}
      {achievements && achievements.length > 0 && (
        <>
          <section className="mt-24">
            <SectionHeading
              title={t("achievements_title")}
              count={`${achievements.filter((a) => a.earned).length}/${achievements.length}`}
            />
            <div className="mt-10 flex flex-wrap gap-x-4 gap-y-8">
              {achievements.map((a) => (
                <div
                  key={a.key}
                  title={a.description?.[locale] ?? a.description?.["en-US"] ?? ""}
                  className="flex w-20 flex-col items-center gap-1.5 text-center"
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full border",
                      a.earned
                        ? "border-gold/50 bg-gold/10 text-gold"
                        : "border-border-default text-text-muted opacity-40"
                    )}
                  >
                    <Icon name={achievementIcon(a.icon)} className="h-5 w-5" />
                  </span>
                  <span className={cn("text-[11px] leading-tight", a.earned ? "text-text-secondary" : "text-text-muted")}>
                    {a.title[locale] ?? a.title["en-US"]}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      </div>

      {paperData && (
        <ShareCardModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          totalValue={paperTotalValue}
          pnl={paperPnl}
          pnlPct={paperPnlPct}
          achievements={achievements?.filter((a) => a.earned).length ?? 0}
        />
      )}
    </div>
  );
}

function LedgerRow({ entry, locale, t }: { entry: LedgerEntry; locale: string; t: ReturnType<typeof useTranslations> }) {
  const date = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }).format(new Date(entry.date));

  if (entry.kind === "achievement") {
    return (
      // 该行是 flex + justify-between 且不换行，成就标题是自由文本，长度不受控；
      // 给左侧容器 min-w-0 并把标题截断，避免长标题在窄屏把整行撑出水平滚动
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">{date}</span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-gold">
            <Icon name="check" className="h-3 w-3" strokeWidth={2.4} />
          </span>
          <span className="truncate text-sm text-text-primary">{t("achievement_unlocked_prefix")} · {entry.title}</span>
        </div>
        <span className="shrink-0 font-mono text-xs text-text-muted">—</span>
      </div>
    );
  }

  const o = entry.order;
  const isBuy = o.side === "buy";
  const marketLabel = o.market_type === "spot" ? t("market_spot") : t("market_futures");

  return (
    // 同上：symbol 是交易对代码，长度不固定（如 1000SHIBUSDT 类），配合日期/买卖徽标/市场标签
    // 四个定宽元素挤在不换行的一行里，窄屏下是真实的溢出风险
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">{date}</span>
        <span
          className={cn(
            "shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            isBuy ? "border-success/40 text-success" : "border-danger/40 text-danger"
          )}
        >
          {isBuy ? t("buy") : t("sell")}
        </span>
        <span className="truncate text-sm text-text-primary">
          {o.symbol} <span className="text-xs text-text-muted">{marketLabel}</span>
        </span>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-text-secondary">
        {o.total_value != null ? `${formatPrice(o.total_value)} USDT` : "—"}
      </span>
    </div>
  );
}

function FavoriteRow({ symbol, locale }: { symbol: string; locale: string }) {
  const ticker = useMarketStore((s) => s.tickers[symbol]);
  if (!ticker) {
    return (
      <div className="flex items-center justify-between border-b border-border-default py-3 first:pt-4 text-xs">
        <span className="font-medium text-text-primary">{symbol}</span>
        <span className="text-text-muted">—</span>
      </div>
    );
  }
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
  return (
    <Link
      href={`/${locale}/trade`}
      className="flex items-center justify-between border-b border-border-default py-3 first:pt-4 text-xs hover:text-gold"
    >
      <span className="font-medium text-text-primary">{symbol}</span>
      <span className="flex items-center gap-3 font-mono">
        <span className="tabular-nums text-text-secondary">{formatPrice(Number(ticker.lastPrice))}</span>
        <span className={cn("tabular-nums font-medium", isPositive ? "text-success" : "text-danger")}>
          {formatPercent(parseFloat(ticker.priceChangePercent))}
        </span>
      </span>
    </Link>
  );
}
