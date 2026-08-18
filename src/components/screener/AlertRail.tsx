"use client";

import { useTranslations } from "next-intl";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { AlertCard } from "./AlertCard";

export function AlertRail({ alerts }: { alerts: AlertRecord[] }) {
  const t = useTranslations("screener");

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
        alerts.map((a) => <AlertCard key={a.id} alert={a} />)
      )}
    </aside>
  );
}
