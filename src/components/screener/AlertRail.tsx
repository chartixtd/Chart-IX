"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import type { AlertCardData, DeadReason } from "@/lib/screener/cards";
import { cardDeadReason } from "@/lib/screener/cards";
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

  /**
   * 已经判过死的卡，**判过就记住**。
   *
   * 前端那一路读的是逐笔成交价，价格在失效线附近来回蹭时，不记住的话同一张
   * 卡会反复「失效→复活」，而它现在还牵着排序——用户看到的就是一张卡在列表
   * 中间和末尾之间跳。服务端的口径本来就是「碰过就算碰过」（拿 K 线极值判，
   * 插针也算），这里记住它，两边才是同一个语义。
   *
   * 刷新页面会清空，那时服务端多半已经确认过了，会从 card.expired 那一路
   * 重新得到同一个结论。
   */
  const deadOnce = useRef(new Map<string, DeadReason>());

  const now = Date.now();
  const graded = cards.map((card) => {
    const reason = cardDeadReason(card, prices[card.symbol] ?? null, now);
    if (reason) deadOnce.current.set(card.key, reason);
    return { card, deadBy: deadOnce.current.get(card.key) ?? null };
  });

  // 活的在前、死的沉底，两组各自保持服务端给的顺序（Array.sort 是稳定的）。
  // 服务端已经把它知道的灰卡排到最后了，这里补的是它不知道的那一半：前端
  // 用实时价刚判出失效的卡，在服务端眼里还是活卡，不重排就会夹在活卡中间。
  const ordered = [...graded].sort((a, b) => Number(a.deadBy !== null) - Number(b.deadBy !== null));

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
      {ordered.map(({ card, deadBy }) => (
        <AlertCard
          key={card.key}
          card={card}
          livePrice={prices[card.symbol] ?? null}
          deadBy={deadBy}
        />
      ))}
    </div>
  );
}
