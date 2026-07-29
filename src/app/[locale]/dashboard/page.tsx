/**
 * DIRECTION CONTRACT — "我的主页" restructure (surface-level, established world)
 * THESIS: this is a private-bank statement of one account, not a card-grid
 *   dashboard. It refuses the four-tile-plus-emoji-stats pattern the page
 *   shipped with. One account, one ledger, one page — read top to bottom
 *   like a monthly statement, not scanned as a grid of widgets.
 * OWN-WORLD: inherits DESIGN.md as-is — warm charcoal ground, engraved
 *   champagne gold, Marcellus display for the headline figure, hairline-gold
 *   rules dividing sections instead of card borders, JetBrains Mono for every
 *   figure. No emoji, no colored pill stat tiles, no card-grid page structure.
 * STORY: visitor understands this is their account statement, not a widget
 *   board; believes their standing (paper equity, real trading activity,
 *   learning progress) is being tracked precisely; acts by continuing to
 *   trade, learn, or review a specific entry.
 * FIRST VIEWPORT: masthead (greeting + statement period) → hairline → Account
 *   Summary (oversized mono equity figure, ruled sub-line items) → hairline →
 *   unified chronological Ledger merging real trade fills and achievement
 *   unlocks → hairline → Continue Learning / Watchlist two-up → hairline →
 *   Latest Content two-up.
 * FORM: surface-level restructure inside the established world (new-work.md
 *   §3, "create a whole surface inside an established world"); no new tokens,
 *   no DESIGN.md change.
 */
"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFavoritesStore } from "@/stores/favorites";
import { useMarketStore } from "@/stores/market";
import { usePaperAccount } from "@/hooks/usePaperTrading";
import { useSpotBalances } from "@/hooks/useTradingAccount";
import { useAchievements } from "@/hooks/useAchievements";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShareCardModal } from "@/components/dashboard/ShareCardModal";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Video, Article, Locale, Order } from "@/types";

interface ContinueWatchingItem {
  video_id: string;
  progress_seconds: number;
  completed: boolean;
  video: Pick<Video, "id" | "title" | "duration_seconds" | "thumbnail_url"> | null;
}

type LedgerEntry =
  | { kind: "trade"; id: string; date: string; order: Order }
  | { kind: "achievement"; id: string; date: string; title: string; icon: string };

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const auth = useAuth();
  const favorites = useFavoritesStore((s) => s.favorites);

  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[] | null>(null);
  const [latestVideos, setLatestVideos] = useState<Video[] | null>(null);
  const [latestArticles, setLatestArticles] = useState<Article[] | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [summaryMode, setSummaryMode] = useState<"live" | "paper">("live");

  const { data: paperData, isLoading: paperLoading } = usePaperAccount(!!auth.userId);
  const { data: spotBalances, isLoading: spotLoading, error: spotError } = useSpotBalances(!!auth.userId);
  const { data: achievements } = useAchievements(auth.userId);

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

  useEffect(() => {
    if (!auth.userId) return;
    const supabase = createClient();

    supabase
      .from("video_progress")
      .select("video_id, progress_seconds, completed, video:videos(id, title, duration_seconds, thumbnail_url)")
      .eq("user_id", auth.userId)
      .eq("completed", false)
      .order("updated_at", { ascending: false })
      .limit(3)
      .then(({ data }) => setContinueWatching((data as unknown as ContinueWatchingItem[]) ?? []));

    supabase
      .from("videos")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(4)
      .then(({ data }) => setLatestVideos((data as Video[]) ?? []));

    supabase
      .from("articles")
      .select("*")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(4)
      .then(({ data }) => setLatestArticles((data as Article[]) ?? []));
  }, [auth.userId]);

  useEffect(() => {
    if (!auth.userId) return;
    const supabase = createClient();
    supabase
      .from("orders")
      .select("*")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setOrders((data as unknown as Order[]) ?? []));
  }, [auth.userId]);

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
      <div className="mx-auto max-w-5xl px-4 py-12">
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
      <div className="mx-auto max-w-5xl px-4 py-16">
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-gold">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 018 0v3" />
            </svg>
          }
          title="请先登录"
          description="登录后即可查看你的学习进度、模拟盘战绩与自选行情。"
          action={
            <Link href={`/${locale}/login`}>
              <Badge variant="gold" size="md">前往登录</Badge>
            </Link>
          }
        />
      </div>
    );
  }

  const displayName = auth.displayName || auth.email?.split("@")[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:py-16">
      {/* Masthead */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-display text-3xl tracking-tight text-text-primary">
          {t("welcome")}{displayName ? `, ${displayName}` : ""}
        </h1>
        {statementPeriod && (
          <p className="font-mono text-xs uppercase tracking-wider text-text-muted">
            对账区间 · {statementPeriod}
          </p>
        )}
      </div>
      <div className="hairline-gold mt-5" />

      {/* Account Summary */}
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">
            {summaryMode === "live" ? "实盘账户" : t("paper_title")}
          </p>
          <div className="flex items-center gap-5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setSummaryMode("live")}
              className={cn(
                "border-b-2 pb-1 transition-colors",
                summaryMode === "live" ? "border-gold text-text-primary" : "border-transparent text-text-muted hover:text-text-secondary"
              )}
            >
              实盘账户
            </button>
            <button
              type="button"
              onClick={() => setSummaryMode("paper")}
              className={cn(
                "border-b-2 pb-1 transition-colors",
                summaryMode === "paper" ? "border-gold text-text-primary" : "border-transparent text-text-muted hover:text-text-secondary"
              )}
            >
              模拟盘
            </button>
          </div>
        </div>

        {summaryMode === "live" ? (
          <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
              {spotLoading ? (
                <Skeleton className="h-14 w-64" />
              ) : liveNotConnected ? (
                <div>
                  <div className="font-display text-3xl tracking-tight text-text-muted md:text-4xl">
                    未绑定 BingX 账户
                  </div>
                  <Link href={`/${locale}/settings/api-keys`} className="mt-2 inline-block text-sm font-medium text-gold hover:underline">
                    前往设置绑定 API 密钥 →
                  </Link>
                </div>
              ) : (
                <div>
                  <div className="font-display text-5xl tracking-tight text-text-primary tabular-nums md:text-6xl">
                    {formatPrice(liveTotalValue)}
                    <span className="ml-2 font-sans text-lg font-normal text-text-muted">USDT</span>
                  </div>
                  <div className="mt-2 font-mono text-sm text-text-muted">
                    完整余额 · 现货 + 合约账户 · 持仓 {liveHoldingsCount} 项现货资产
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Link href={`/${locale}/trade`} className="text-xs font-medium text-gold hover:underline">
                  进入实盘交易 →
                </Link>
              </div>
            </div>

            {/* Ruled sub-line items */}
            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-border-default pt-5 font-mono text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-text-muted">现货资产价值</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{formatPrice(spotTotalValue)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">合约账户权益</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{formatPrice(futuresEquity)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">现货可用 USDT</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{formatPrice(liveUsdtBalance)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">持仓资产数</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{liveHoldingsCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">实盘成交额</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{formatPrice(tradeStats.totalVolume)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">实盘净额</dt>
                <dd className={cn("mt-1 tabular-nums", tradeStats.netPnl >= 0 ? "text-success" : "text-danger")}>
                  {tradeStats.netPnl >= 0 ? "+" : ""}{formatPrice(tradeStats.netPnl)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">最常交易对</dt>
                <dd className="mt-1 tabular-nums text-text-primary">
                  {tradeStats.mostTradedPair || "—"}
                  {tradeStats.maxCount > 0 && <span className="text-text-muted"> ×{tradeStats.maxCount}</span>}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
              {paperLoading ? (
                <Skeleton className="h-14 w-64" />
              ) : (
                <div>
                  <div className="font-display text-5xl tracking-tight text-text-primary tabular-nums md:text-6xl">
                    {formatPrice(paperTotalValue)}
                    <span className="ml-2 font-sans text-lg font-normal text-text-muted">USDT</span>
                  </div>
                  <div className={cn("mt-2 font-mono text-sm font-medium", paperPnl >= 0 ? "text-success" : "text-danger")}>
                    {paperPnl >= 0 ? "+" : ""}{formatPrice(paperPnl)} USDT ({formatPercent(paperPnlPct)}) 累计
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
                    分享
                  </Button>
                )}
                <Link href={`/${locale}/trade`} className="text-xs font-medium text-gold hover:underline">
                  {t("paper_cta")} →
                </Link>
              </div>
            </div>

            {/* Ruled sub-line items */}
            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-border-default pt-5 font-mono text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-text-muted">{t("paper_balance")}</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{formatPrice(paperData?.account.balance_usdt ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">累计盈亏</dt>
                <dd className={cn("mt-1 tabular-nums", paperPnl >= 0 ? "text-success" : "text-danger")}>
                  {paperPnl >= 0 ? "+" : ""}{formatPrice(paperPnl)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">累计收益率</dt>
                <dd className={cn("mt-1 tabular-nums", paperPnlPct >= 0 ? "text-success" : "text-danger")}>
                  {formatPercent(paperPnlPct)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">持仓数量</dt>
                <dd className="mt-1 tabular-nums text-text-primary">{paperData?.positions.length ?? 0}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <div className="hairline-gold mt-10" />

      {/* Unified ledger */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl tracking-tight text-text-primary">本期台账</h2>
          <Link href={`/${locale}/orders`} className="text-xs font-medium text-gold hover:underline">
            查看全部订单 →
          </Link>
        </div>

        {orders === null ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : ledger.length === 0 ? (
          <p className="mt-5 border-y border-border-default py-6 text-center text-sm text-text-muted">
            暂无交易或成就记录，去模拟盘练一笔，或完成一节课解锁第一个成就。
          </p>
        ) : (
          <div className="mt-5 divide-y divide-border-default border-y border-border-default">
            {ledger.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} locale={locale} />
            ))}
          </div>
        )}
      </section>

      <div className="hairline-gold mt-10" />

      {/* Continue learning + watchlist */}
      <section className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl tracking-tight text-text-primary">{t("continue_learning_title")}</h2>
            <Link href={`/${locale}/videos`} className="text-xs text-text-muted hover:text-gold">→</Link>
          </div>
          <div className="mt-4 border-t border-border-default">
            {continueWatching === null ? (
              <Skeleton className="mt-4 h-16" />
            ) : continueWatching.length === 0 ? (
              <div className="pt-4">
                <p className="text-xs text-text-muted">{t("continue_learning_empty")}</p>
                <Link href={`/${locale}/videos`} className="mt-2 inline-block text-xs font-medium text-gold hover:underline">
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
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-bg-tertiary">
                        <span className="block h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="font-mono text-xs tabular-nums text-text-muted">{pct}%</span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl tracking-tight text-text-primary">{t("favorites_title")}</h2>
            <Link href={`/${locale}/trade`} className="text-xs text-text-muted hover:text-gold">→</Link>
          </div>
          <div className="mt-4 border-t border-border-default">
            {favorites.length === 0 ? (
              <div className="pt-4">
                <p className="text-xs text-text-muted">{t("favorites_empty")}</p>
                <Link href={`/${locale}/trade`} className="mt-2 inline-block text-xs font-medium text-gold hover:underline">
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

      <div className="hairline-gold mt-10" />

      {/* Latest content */}
      <section className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl tracking-tight text-text-primary">{t("latest_videos_title")}</h2>
            <Link href={`/${locale}/videos`} className="text-xs text-text-muted hover:text-gold">→</Link>
          </div>
          <div className="mt-4 border-t border-border-default">
            {latestVideos === null ? (
              <Skeleton className="mt-4 h-24" />
            ) : (
              latestVideos.map((video) => (
                <Link
                  key={video.id}
                  href={`/${locale}/videos/${video.id}`}
                  className="flex items-center gap-3 border-b border-border-default py-3 first:pt-4"
                >
                  <div className="h-10 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                    {video.thumbnail_url && (
                      <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <span className="truncate text-sm text-text-secondary hover:text-gold">
                    {video.title[locale] ?? video.title["en-US"]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl tracking-tight text-text-primary">{t("latest_articles_title")}</h2>
            <Link href={`/${locale}/articles`} className="text-xs text-text-muted hover:text-gold">→</Link>
          </div>
          <div className="mt-4 border-t border-border-default">
            {latestArticles === null ? (
              <Skeleton className="mt-4 h-24" />
            ) : (
              latestArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/${locale}/articles/${article.slug}`}
                  className="block border-b border-border-default py-3 first:pt-4"
                >
                  <span className="truncate text-sm text-text-secondary hover:text-gold">
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
          <div className="hairline-gold mt-10" />
          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-xl tracking-tight text-text-primary">{t("achievements_title")}</h2>
              <span className="font-mono text-xs tabular-nums text-text-muted">
                {achievements.filter((a) => a.earned).length}/{achievements.length}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-4">
              {achievements.map((a) => (
                <div
                  key={a.key}
                  title={a.description?.[locale] ?? a.description?.["en-US"] ?? ""}
                  className="flex w-20 flex-col items-center gap-1.5 text-center"
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full border text-base",
                      a.earned
                        ? "border-gold/50 bg-gold/10 shadow-[0_0_0_1px_rgba(201,162,75,0.15)]"
                        : "border-border-default text-text-muted grayscale opacity-35"
                    )}
                  >
                    {a.icon}
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

function LedgerRow({ entry, locale }: { entry: LedgerEntry; locale: string }) {
  const date = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }).format(new Date(entry.date));

  if (entry.kind === "achievement") {
    return (
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-text-muted">{date}</span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-[11px] text-gold">
            ✓
          </span>
          <span className="text-sm text-text-primary">解锁成就 · {entry.title}</span>
        </div>
        <span className="font-mono text-xs text-text-muted">—</span>
      </div>
    );
  }

  const o = entry.order;
  const isBuy = o.side === "buy";
  const marketLabel = o.market_type === "spot" ? "现货" : "合约";

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-text-muted">{date}</span>
        <span
          className={cn(
            "rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            isBuy ? "border-success/40 text-success" : "border-danger/40 text-danger"
          )}
        >
          {isBuy ? "买入" : "卖出"}
        </span>
        <span className="text-sm text-text-primary">{o.symbol}</span>
        <span className="text-xs text-text-muted">{marketLabel}</span>
      </div>
      <span className="font-mono text-sm tabular-nums text-text-secondary">
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
