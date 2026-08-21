"use client";

import { useTranslations } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { AlertRail } from "@/components/screener/AlertRail";

/**
 * 警报卡片子页。
 *
 * 卡片是主扫描表的**视图**，不是另一份数据：每一张都来自当轮扫描里判出
 * 场景、且未被价格打穿失效线的行。所以这两个子页共用同一次请求
 * （react-query 按 queryKey 去重），不会因为分成两页而多打一次接口。
 */
export default function ScreenerAlertsPage() {
  const t = useTranslations("screener");
  const { cards, isLoading } = useScannerData();

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-sm font-semibold tracking-tight text-text-primary">
          {t("alerts.rail_label")}
        </h2>
        <span className="text-[11px] text-text-muted">{t("alerts.page_hint")}</span>
      </div>
      <AlertRail cards={cards} isLoading={isLoading} />
    </section>
  );
}
