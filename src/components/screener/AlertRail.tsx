"use client";

import { useTranslations } from "next-intl";
import type { ScenarioCard } from "@/lib/screener/cards";
import { useCardPrices } from "@/hooks/useCardPrices";
import { AlertCard } from "./AlertCard";

export function AlertRail({ cards }: { cards: ScenarioCard[] }) {
  const t = useTranslations("screener");
  // 一次订阅整条栏需要的 symbol。卡片自己去订会让每张卡各开一条连接，
  // 而它们的集合本来就是同一份数据。
  const prices = useCardPrices(cards.map((c) => c.symbol));

  return (
    <aside className="flex flex-col gap-3">
      <h2 className="text-[11px] uppercase tracking-wider text-text-muted">
        {t("alerts.rail_label")}
      </h2>
      {cards.length === 0 ? (
        <p className="rounded-lg panel px-3.5 py-3 text-[11px] leading-relaxed text-text-secondary">
          {t("alerts.empty")}
        </p>
      ) : (
        cards.map((c) => <AlertCard key={c.key} card={c} livePrice={prices[c.symbol] ?? null} />)
      )}
    </aside>
  );
}
