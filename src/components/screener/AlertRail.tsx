"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import type { AlertCardData } from "@/lib/screener/cards";
import { useCardPrices } from "@/hooks/useCardPrices";
import { AlertCard } from "./AlertCard";

/**
 * 卡片列表。自适应多列——卡片有了自己的子页之后不再是侧边栏那一竖条，
 * 宽屏上挤在一列会浪费大半个屏幕。单张卡的内容密度不变。
 */
export function AlertRail({ cards, isLoading = false }: { cards: AlertCardData[]; isLoading?: boolean }) {
  const t = useTranslations("screener");
  // 一次订阅整页需要的 symbol。让每张卡自己去订会各开一条 WebSocket，
  // 而它们要的本来就是同一份行情。
  const prices = useCardPrices(cards.map((c) => c.symbol));

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[26rem] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    // 空态用站内统一的 EmptyState，不再是一行 11px 的灰字：没有信号是这一页
    // 最常见的状态之一，它值得被排成一个安静的画面而不是一句注脚。
    return (
      <EmptyState
        icon={<Icon name="bell" className="h-6 w-6" />}
        title={t("alerts.empty_title")}
        description={t("alerts.empty")}
        className="border-y border-border-default"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {cards.map((c) => (
        <AlertCard key={c.key} card={c} livePrice={prices[c.symbol] ?? null} />
      ))}
    </div>
  );
}
