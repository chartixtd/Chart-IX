"use client";

import { useTranslations } from "next-intl";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { useLivePrices } from "@/hooks/useLivePrices";
import { AlertCard } from "./AlertCard";

export function AlertRail({ alerts }: { alerts: AlertRecord[] }) {
  const t = useTranslations("screener");
  // 在这里取一次而不是每张卡各取一次：react-query 按 queryKey 去重，
  // 20 张卡各调一次 useLivePrices 也只会发一个请求，但把它提到这里
  // 语义更直白——这是整条警报栏共享的一份行情。
  const { prices } = useLivePrices();

  return (
    <aside className="flex flex-col gap-3">
      <h2 className="text-[11px] uppercase tracking-wider text-text-muted">
        {t("alerts.rail_label")}
      </h2>
      {alerts.length === 0 ? (
        <p className="rounded-lg panel px-3.5 py-3 text-[11px] leading-relaxed text-text-secondary">
          {t("alerts.empty")}
        </p>
      ) : (
        alerts.map((a) => <AlertCard key={a.id} alert={a} livePrice={prices[a.symbol] ?? null} />)
      )}
    </aside>
  );
}
