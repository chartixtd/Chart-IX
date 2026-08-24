"use client";

import { memo } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecentTrades } from "@/hooks/useMarketData";
import { markLargeTrades } from "@/lib/trading/trade-tape";
import { canViewTradeTape } from "@/lib/access";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

interface RecentTradesProps {
  symbol: string;
  /** 这个面板当前是否可见（标签是否选中）——不可见时不订阅 WebSocket。 */
  active: boolean;
  /** REST 回落请求走哪个市场的成交接口；WebSocket 主路径本身不区分市场。 */
  market?: "spot" | "futures";
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export const RecentTrades = memo(function RecentTrades({ symbol, active, market = "spot" }: RecentTradesProps) {
  const t = useTranslations("trade.recent_trades");
  const locale = useLocale();
  const auth = useAuth();

  const canView = canViewTradeTape(auth.tier);
  const enabled = active && canView;
  const { data, isLoading } = useRecentTrades(symbol, enabled, 20, market);

  // Pro 权限未就绪（auth.loading）时不显示锁——避免 Pro 用户刷新页面时闪一下锁定态。
  if (!auth.loading && !canView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs">
        <p className="text-text-secondary">{t("locked")}</p>
        <Link href={`/${locale}/upgrade`} className="font-medium text-gold hover:underline">
          {t("locked_cta")} →
        </Link>
      </div>
    );
  }

  if (isLoading || auth.loading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <Skeleton key={i} className="h-4" />
        ))}
      </div>
    );
  }

  const trades = markLargeTrades(data ?? []);

  return (
    <div className="text-xs">
      <div className="grid grid-cols-3 gap-1 px-2 py-1.5 text-text-muted border-b border-border-default">
        <span>{t("time")}</span>
        <span className="text-right">{t("price")}</span>
        <span className="text-right">{t("qty")}</span>
      </div>

      {trades.length === 0 ? (
        <p className="p-4 text-center text-text-muted">{t("empty")}</p>
      ) : (
        trades.map((trade, index) => {
          const isBuy = !trade.isBuyerMaker;
          const priceColor = isBuy ? "text-success" : "text-danger";
          return (
            <div
              key={`${trade.id}-${trade.time}-${index}`}
              className={cn(
                // font-mono tnum：每 tick 重绘的数字列必须等宽，否则刷新时列宽跳动
                "grid grid-cols-3 gap-1 px-2 py-0.5 font-mono tnum",
                trade.isLarge && (isBuy ? "bg-success/10 font-semibold" : "bg-danger/10 font-semibold")
              )}
            >
              <span className="text-text-muted">{formatTime(trade.time)}</span>
              <span className={cn("text-right", priceColor)}>{formatPrice(parseFloat(trade.price))}</span>
              <span className="text-right text-text-secondary">{trade.qty}</span>
            </div>
          );
        })
      )}
    </div>
  );
});
