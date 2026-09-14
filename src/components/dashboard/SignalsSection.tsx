"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { useCardPrices } from "@/hooks/useCardPrices";
import { signedPct } from "@/lib/screener/cards";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import { toneFor, DIRECTION_CLASSES } from "@/components/screener/scenario-ui";
import { signalCopy, triggeredLabel } from "@/components/screener/signal-copy";
import { Skeleton } from "@/components/ui/Skeleton";
import { DashSection, DashNote } from "./Section";
import { cn, formatPercent } from "@/lib/utils";

/** 主页上最多列三条。要看全部去扫描器——这里回答的是「现在值不值得过去」 */
const MAX_ROWS = 3;

/**
 * 距离下一轮扫描还有多久，mm:ss。
 *
 * 基准是服务端的 `computedAt` 而不是客户端第一次拿到数据的时刻——所有人
 * 看到的倒计时因此是同一个（扫描器页抬头的表盘用的也是这个基准）。
 */
function useRescanCountdown(lastUpdated: number): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastUpdated) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  if (!lastUpdated) return null;
  const left = Math.max(0, lastUpdated + SCAN_INTERVAL_MS - now);
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * 主页的信号区：现在有几个活着的信号，最上面的三条是什么。
 *
 * 数据与扫描器页共用同一个 react-query key，所以这一区**不产生额外请求**；
 * 「活着」的判据也必须与那一页的巨型数字一致（只数没过期的卡），否则主页说
 * 4 个、点进去只有 2 张亮卡。
 *
 * 实时价只订阅这三条要显示的，不是全部卡片——主页要的是一眼，不是一台终端。
 */
export function SignalsSection() {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const tScreener = useTranslations("screener");
  const { cards, isLoading, lastUpdated } = useScannerData();

  const live = useMemo(() => cards.filter((card) => !card.expired), [cards]);
  const shown = useMemo(() => live.slice(0, MAX_ROWS), [live]);
  const prices = useCardPrices(useMemo(() => shown.map((card) => card.symbol), [shown]));
  const countdown = useRescanCountdown(lastUpdated);

  const meta =
    live.length > 0 && countdown
      ? t("signals_meta", { count: live.length, time: countdown })
      : null;

  return (
    <DashSection title={t("signals_title")} meta={meta}>
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: MAX_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <DashNote>
          {t("signals_empty")}{" "}
          <Link href={`/${locale}/screener`} className="link-underline text-gold">
            {t("signals_cta")}
          </Link>
        </DashNote>
      ) : (
        <ul className="flex flex-col">
          {shown.map((card) => {
            const tone = toneFor(card.trigger);
            const dir = DIRECTION_CLASSES[card.direction];
            const { action } = signalCopy(card.trigger, tScreener);
            const price = prices[card.symbol];
            const pct = price ? signedPct(card.firstPrice, price, card.direction) : null;
            // 点火卡用 ignitedAt（点火那根 K 线的时刻，是 ms 数字不是 ISO），
            // 场景卡用 firstSeenAt——与警报卡的取法必须一致，否则同一条信号
            // 在两处显示的「多久以前」对不上。见 AlertCard 里那段说明。
            const triggeredAt =
              card.trigger.type === "ignition"
                ? new Date(card.trigger.ignition.ignitedAt).toISOString()
                : card.firstSeenAt;

            return (
              <li key={card.key}>
                <Link
                  href={`/${locale}/screener/alerts`}
                  // 左边那道场景基调色的竖线是**标注**不是填充：颜色说的是
                  // 「这是哪一类信号」，不是「这一行更重要」
                  className={cn(
                    "flex items-start gap-3 border-l-2 py-3 pl-3 pr-1 transition-colors",
                    "hover:bg-bg-secondary/40",
                    tone.border
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[15px] font-medium tracking-tight text-text-primary">
                        {card.coin}
                      </span>
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em]",
                          dir.pillBg,
                          dir.pillText
                        )}
                      >
                        {card.direction === "manage"
                          ? tScreener("scenarios.pill_manage")
                          : card.direction}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[13px] text-text-secondary">
                      {action}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        "block font-mono text-[15px] tabular-nums",
                        pct === null
                          ? "text-text-muted"
                          : pct >= 0
                            ? "text-success"
                            : "text-danger"
                      )}
                    >
                      {pct === null ? "—" : formatPercent(pct)}
                    </span>
                    <span className="mt-1 block text-[11px] text-text-muted">
                      {triggeredLabel(triggeredAt, tScreener)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashSection>
  );
}
