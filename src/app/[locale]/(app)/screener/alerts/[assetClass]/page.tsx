"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useScannerData } from "@/hooks/useScreenerData";
import { cardDeadReason } from "@/lib/screener/cards";
import { AlertRail } from "@/components/screener/AlertRail";
import { SectionHeading } from "@/components/ui/Section";
import { isLaneKey, cardsInLane } from "@/lib/screener/lanes";

/**
 * 警报卡片的一栏。三条路由共用这一个组件：
 * `/screener/alerts/crypto`、`/screener/alerts/commodity`、`/screener/alerts/stock`。
 *
 * 卡片是主扫描表的**视图**，不是另一份数据：每一张都来自当轮扫描里判出
 * 场景、且未被价格打穿失效线的行。所以六个子页共用同一次请求
 * （react-query 按 queryKey 去重），不会因为分页而多打接口。
 *
 * 卡片按哪一栏归属，是**从 symbol 的前缀推**出来的，不是存在卡上的字段
 * ——理由见 lanes.ts 的 laneOfSymbol，关键一条是一张卡能活 6 小时、
 * 跨得过好几轮部署，存字段会让旧卡分不了类。
 *
 * 计数写成「活着的 / 全部」：灰掉的已结束卡也在列表里（为了对照推送），
 * 但它们不是信号，不该混进同一个数。
 */
export default function ScreenerAlertsLanePage() {
  const t = useTranslations("screener");
  const params = useParams<{ assetClass: string }>();
  const lane = params.assetClass;
  if (!isLaneKey(lane)) notFound();

  const { cards, isLoading } = useScannerData();
  const laneCards = useMemo(() => cardsInLane(cards, lane), [cards, lane]);

  // 超时的卡在服务端下一轮才会标成 expired，但它此刻已经不是活信号了，
  // 不该算进这个数——否则抬头写着 4 个活跃信号，而底下有一张已经灰了。
  // 实时价穿线那一路算不进来（这里没有行情订阅），那种卡最多错一刻钟。
  const liveCount = useMemo(
    () => laneCards.filter((c) => cardDeadReason(c, null, Date.now()) === null).length,
    [laneCards]
  );

  return (
    <section>
      <SectionHeading
        title={t(`lanes.${lane}.title`)}
        count={isLoading || laneCards.length === 0 ? null : `${liveCount}/${laneCards.length}`}
        action={
          <span className="hidden max-w-md text-xs text-text-muted md:inline">
            {t("alerts.page_hint")}
          </span>
        }
      />
      <div className="mt-8">
        <AlertRail cards={laneCards} isLoading={isLoading} />
      </div>
    </section>
  );
}
