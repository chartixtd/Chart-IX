"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { AlertRail } from "@/components/screener/AlertRail";
import { SectionHeading } from "@/components/ui/Section";

/**
 * 警报卡片子页。
 *
 * 卡片是主扫描表的**视图**，不是另一份数据：每一张都来自当轮扫描里判出
 * 场景、且未被价格打穿失效线的行。所以这两个子页共用同一次请求
 * （react-query 按 queryKey 去重），不会因为分成两页而多打一次接口。
 *
 * 计数写成「活着的 / 全部」：灰掉的已结束卡也在列表里（为了对照推送），
 * 但它们不是信号，不该混进同一个数。
 */
export default function ScreenerAlertsPage() {
  const t = useTranslations("screener");
  const { cards, isLoading } = useScannerData();
  const liveCount = useMemo(() => cards.filter((c) => !c.expired).length, [cards]);

  return (
    <section>
      <SectionHeading
        title={t("alerts.rail_label")}
        count={isLoading || cards.length === 0 ? null : `${liveCount}/${cards.length}`}
        action={<span className="hidden max-w-md text-xs text-text-muted md:inline">{t("alerts.page_hint")}</span>}
      />
      <div className="mt-8">
        <AlertRail cards={cards} isLoading={isLoading} />
      </div>
    </section>
  );
}
