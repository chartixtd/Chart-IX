"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ScenarioCard } from "@/lib/screener/cards";
import { useCardPrices } from "@/hooks/useCardPrices";
import { AlertCard } from "./AlertCard";

/**
 * 卡片列表。自适应多列——卡片有了自己的子页之后不再是侧边栏那一竖条，
 * 宽屏上挤在一列会浪费大半个屏幕。单张卡的内容密度不变。
 */
export function AlertRail({ cards, isLoading = false }: { cards: ScenarioCard[]; isLoading?: boolean }) {
  const t = useTranslations("screener");
  // 一次订阅整页需要的 symbol。让每张卡自己去订会各开一条 WebSocket，
  // 而它们要的本来就是同一份行情。
  const prices = useCardPrices(cards.map((c) => c.symbol));

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <p className="rounded-lg panel px-3.5 py-3 text-[11px] leading-relaxed text-text-secondary">
        {t("alerts.empty")}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <AlertCard key={c.key} card={c} livePrice={prices[c.symbol] ?? null} />
      ))}
    </div>
  );
}
