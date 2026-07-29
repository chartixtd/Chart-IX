"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFavoritesStore } from "@/stores/favorites";
import { useMarketStore } from "@/stores/market";
import { usePaperAccount } from "@/hooks/usePaperTrading";
import { useAchievements } from "@/hooks/useAchievements";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShareCardModal } from "@/components/dashboard/ShareCardModal";
import { formatPrice, formatPercent, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Video, Article, Locale, Order } from "@/types";

interface ContinueWatchingItem {
  video_id: string;
  progress_seconds: number;
  completed: boolean;
  video: Pick<Video, "id" | "title" | "duration_seconds" | "thumbnail_url"> | null;
}

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

  const { data: paperData, isLoading: paperLoading } = usePaperAccount(!!auth.userId);
  const { data: achievements } = useAchievements(auth.userId);
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

  const filledOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => o.status === "filled" || o.status === "partially_filled");
  }, [orders]);

  const tradeStats = useMemo(() => {
    const filled = filledOrders;
    const allOrders = orders ?? [];
    const totalTrades = filled.length;
    const totalVolume = filled.reduce((sum, o) => sum + (o.total_value ?? 0), 0);
    const totalFees = filled.reduce((sum, o) => sum + (o.fee ?? 0), 0);
    const totalOrders = allOrders.length;
    const fillRate = totalOrders > 0 ? (totalTrades / totalOrders) * 100 : 0;
    const sellTotal = filled.filter((o) => o.side === "sell").reduce((sum, o) => sum + (o.total_value ?? 0), 0);
    const buyTotal = filled.filter((o) => o.side === "buy").reduce((sum, o) => sum + (o.total_value ?? 0), 0);
    const netPnl = sellTotal - buyTotal - totalFees;
    const winningTrades = filled.filter((o) => o.side === "sell").length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const pairCounts: Record<string, number> = {};
    filled.forEach((o) => {
      pairCounts[o.symbol] = (pairCounts[o.symbol] ?? 0) + 1;
    });
    let mostTradedPair = "";
    let maxCount = 0;
    for (const [pair, count] of Object.entries(pairCounts)) {
      if (count > maxCount) { maxCount = count; mostTradedPair = pair; }
    }
    return { totalTrades, totalVolume, totalFees, netPnl, winRate, fillRate, totalOrders, mostTradedPair, maxCount };
  }, [filledOrders, orders]);

  if (auth.loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <Skeleton className="h-8 w-64" />
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (!auth.userId) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16">
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="font-display text-3xl tracking-tight text-text-primary">
        {t("welcome")}{(auth.displayName || auth.email?.split("@")[0]) ? `, ${auth.displayName || auth.email?.split("@")[0]}` : ""}
      </h1>
      <div className="hairline-gold mt-5 w-full max-w-[220px] opacity-60" />

      <div className="mt-10 grid gap-6 lg:grid-cols-4">
        {/* Paper trading performance */}
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{t("paper_title")}</h2>
          {paperLoading ? (
            <Skeleton className="mt-3 h-16" />
          ) : (
            <>
              <div className="mt-3 text-2xl font-bold text-text-primary">
                {formatPrice(paperTotalValue)} <span className="text-sm font-normal text-text-muted">USDT</span>
              </div>
              <div className={cn("mt-1 text-sm font-medium", paperPnl >= 0 ? "text-success" : "text-danger")}>
                {paperPnl >= 0 ? "+" : ""}{formatPrice(paperPnl)} ({formatPercent(paperPnlPct)})
              </div>
              <div className="mt-3 text-xs text-text-muted">
                {t("paper_balance")}: {formatPrice(paperData?.account.balance_usdt ?? 0)} USDT
              </div>
            </>
          )}
          <div className="mt-4 flex items-center justify-between">
            <Link href={`/${locale}/trade`} className="text-xs font-medium text-gold hover:underline">
              {t("paper_cta")} →
            </Link>
            {paperData && (
              <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                </svg>
                分享
              </Button>
            )}
          </div>
        </Card>

        {/* Trade P&L */}
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">交易盈亏</h2>
          {orders === null ? (
            <Skeleton className="mt-3 h-16" />
          ) : filledOrders.length === 0 ? (
            <div className="mt-3">
              <p className="text-sm text-text-muted">暂无交易数据</p>
            </div>
          ) : (
            <>
              <div className="mt-3 text-2xl font-bold text-text-primary">
                {formatPrice(tradeStats.totalVolume)} <span className="text-sm font-normal text-text-muted">USDT</span>
              </div>
              <div className={cn("mt-1 text-sm font-medium", tradeStats.netPnl >= 0 ? "text-success" : "text-danger")}>
                净额 {tradeStats.netPnl >= 0 ? "+" : ""}{formatPrice(tradeStats.netPnl)} USDT
              </div>
              <div className="mt-3 space-y-0.5 text-xs text-text-muted">
                <div>已成交 <span className="text-text-secondary font-medium">{tradeStats.totalTrades}</span> 笔</div>
                <div>手续费 {formatPrice(tradeStats.totalFees)} USDT</div>
              </div>
            </>
          )}
          <div className="mt-4">
            <Link href={`/${locale}/orders`} className="text-xs font-medium text-gold hover:underline">
              查看订单 →
            </Link>
          </div>
        </Card>

        {/* Favorites */}
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{t("favorites_title")}</h2>
          {favorites.length === 0 ? (
            <div className="mt-3">
              <p className="text-xs text-text-muted">{t("favorites_empty")}</p>
              <Link href={`/${locale}/trade`} className="mt-2 inline-block text-xs font-medium text-gold hover:underline">
                {t("favorites_cta")} →
              </Link>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {favorites.slice(0, 5).map((symbol) => (
                <FavoriteRow key={symbol} symbol={symbol} locale={locale} />
              ))}
            </div>
          )}
        </Card>

        {/* Continue learning */}
        <Card>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{t("continue_learning_title")}</h2>
          {continueWatching === null ? (
            <Skeleton className="mt-3 h-16" />
          ) : continueWatching.length === 0 ? (
            <div className="mt-3">
              <p className="text-xs text-text-muted">{t("continue_learning_empty")}</p>
              <Link href={`/${locale}/videos`} className="mt-2 inline-block text-xs font-medium text-gold hover:underline">
                {t("continue_learning_cta")} →
              </Link>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {continueWatching.map((item) => {
                if (!item.video) return null;
                const pct = item.video.duration_seconds > 0
                  ? Math.min(100, Math.round((item.progress_seconds / item.video.duration_seconds) * 100))
                  : 0;
                return (
                  <Link key={item.video_id} href={`/${locale}/videos/${item.video_id}`} className="block group">
                    <p className="truncate text-xs font-medium text-text-primary group-hover:text-gold">
                      {item.video.title[locale] ?? item.video.title["en-US"]}
                    </p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-tertiary">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">{t("progress_percent", { percent: pct })}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Latest content */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-tight text-text-primary">{t("latest_videos_title")}</h2>
            <Link href={`/${locale}/videos`} className="text-xs text-text-muted hover:text-gold">→</Link>
          </div>
          <div className="mt-3 space-y-2">
            {latestVideos === null ? (
              <Skeleton className="h-24" />
            ) : (
              latestVideos.map((video) => (
                <Link key={video.id} href={`/${locale}/videos/${video.id}`} className="flex items-center gap-3 rounded-sm p-2 hover:bg-bg-tertiary">
                  <div className="h-10 w-16 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                    {video.thumbnail_url && (
                      <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <span className="truncate text-sm text-text-secondary">
                    {video.title[locale] ?? video.title["en-US"]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-tight text-text-primary">{t("latest_articles_title")}</h2>
            <Link href={`/${locale}/articles`} className="text-xs text-text-muted hover:text-gold">→</Link>
          </div>
          <div className="mt-3 space-y-2">
            {latestArticles === null ? (
              <Skeleton className="h-24" />
            ) : (
              latestArticles.map((article) => (
                <Link key={article.id} href={`/${locale}/articles/${article.slug}`} className="block rounded-sm p-2 hover:bg-bg-tertiary">
                  <span className="truncate text-sm text-text-secondary">
                    {article.title[locale] ?? article.title["en-US"]}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Trading Statistics */}
      {orders !== null && filledOrders.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-xl tracking-tight text-text-primary">交易统计</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card padding="sm" className="flex items-center gap-3">
              <span className="text-xl">📊</span>
              <div>
                <p className="text-xs text-text-muted">总交易次数</p>
                <p className="text-lg font-bold text-text-primary">{tradeStats.totalTrades}</p>
              </div>
            </Card>
            <Card padding="sm" className="flex items-center gap-3">
              <span className="text-xl">✅</span>
              <div>
                <p className="text-xs text-text-muted">成交率</p>
                <p className="text-lg font-bold text-text-primary">{formatNumber(tradeStats.fillRate, 1)}%</p>
              </div>
            </Card>
            <Card padding="sm" className="flex items-center gap-3">
              <span className="text-xl">🏆</span>
              <div>
                <p className="text-xs text-text-muted">胜率</p>
                <p className="text-lg font-bold text-text-primary">{formatNumber(tradeStats.winRate, 1)}%</p>
              </div>
            </Card>
            <Card padding="sm" className="flex items-center gap-3">
              <span className="text-xl">💰</span>
              <div>
                <p className="text-xs text-text-muted">总成交量</p>
                <p className="text-lg font-bold text-text-primary">{formatPrice(tradeStats.totalVolume)} USDT</p>
              </div>
            </Card>
            <Card padding="sm" className="flex items-center gap-3">
              <span className="text-xl">🧾</span>
              <div>
                <p className="text-xs text-text-muted">总手续费</p>
                <p className="text-lg font-bold text-text-primary">{formatPrice(tradeStats.totalFees)} USDT</p>
              </div>
            </Card>
            <Card padding="sm" className="flex items-center gap-3">
              <span className="text-xl">🔥</span>
              <div>
                <p className="text-xs text-text-muted">最常交易对</p>
                <p className="text-lg font-bold text-text-primary">
                  {tradeStats.mostTradedPair || "—"}
                  {tradeStats.maxCount > 0 && (
                    <span className="ml-1 text-xs font-normal text-text-muted">×{tradeStats.maxCount}</span>
                  )}
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Achievements */}
      {achievements && achievements.some((a) => a.earned) && (
        <div className="mt-10">
          <h2 className="font-display text-xl tracking-tight text-text-primary">{t("achievements_title")}</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {achievements.map((a) => (
              <div
                key={a.key}
                title={a.description?.[locale] ?? a.description?.["en-US"] ?? ""}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                  a.earned
                    ? "border-gold/40 bg-gold/10 text-gold"
                    : "border-border-default text-text-muted opacity-40"
                )}
              >
                <span>{a.icon}</span>
                <span>{a.title[locale] ?? a.title["en-US"]}</span>
              </div>
            ))}
          </div>
        </div>
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

function FavoriteRow({ symbol, locale }: { symbol: string; locale: string }) {
  const ticker = useMarketStore((s) => s.tickers[symbol]);
  if (!ticker) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-text-primary">{symbol}</span>
        <span className="text-text-muted">—</span>
      </div>
    );
  }
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
  return (
    <Link href={`/${locale}/trade`} className="flex items-center justify-between text-xs hover:text-gold">
      <span className="font-medium text-text-primary">{symbol}</span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums text-text-secondary">{formatPrice(Number(ticker.lastPrice))}</span>
        <span className={cn("tabular-nums font-medium", isPositive ? "text-success" : "text-danger")}>
          {formatPercent(parseFloat(ticker.priceChangePercent))}
        </span>
      </span>
    </Link>
  );
}
