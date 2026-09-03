"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { cn, formatPrice, formatPercent } from "@/lib/utils";
import type { AlertCardData } from "@/lib/screener/cards";
import { signedPct } from "@/lib/screener/cards";
import { isInvalidated } from "@/lib/screener/invalidation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { FactorMeter } from "./FactorMeter";
import { toneFor, DIRECTION_CLASSES, STRENGTH_CLASSES } from "./scenario-ui";

// 接收 t 而不是硬编码文案——页面其余文案全部走 i18n，这里也不能例外
// （英文/马来语环境下直接冒出一个中文"刚刚"是真的会发生的 bug）。
//
// 三条文案各自是**完整的一句话**（「35分钟前触发」），不是「时长」+
// 「触发」两段拼起来的。拼接会拼出「刚刚前触发」这种病句，而且英文与
// 马来语的语序跟中文不同（triggered 35m ago / dicetuskan 35m lalu），
// 靠拼接根本排不对。
function triggeredLabel(iso: string, t: ReturnType<typeof useTranslations>): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("alerts.just_now");
  if (mins < 60) return t("alerts.minutes_ago", { n: mins });
  return t("alerts.hours_ago", { n: Math.round(mins / 60) });
}

/** direction 三态 pill 的文案，manage 统一显示成"观望"。 */
function directionLabel(dir: "long" | "short" | "manage", t: ReturnType<typeof useTranslations>): string {
  if (dir === "long") return "LONG";
  if (dir === "short") return "SHORT";
  return t("scenarios.pill_manage");
}

/**
 * 新鲜度分档。**这套系统比一般行情工具更需要它**，因为信号天生带
 * 「出生延迟」：场景锚在已确认的摆动点上（PIVOT_N=5，要等 5 根 30 分钟
 * K 线走完才确认），所以卡片出现的那一刻，触发它的结构事件至少已经是
 * 2.5 小时前的事。不标出来，读者会把「刚出现」误读成「刚发生」。
 *
 * 4 小时这条线：这类结构事件的生命周期实测是几十分钟到几小时，叠上
 * 2.5 小时的确认延迟，超过 4 小时的卡片基本已经从「入场信号」退化成
 * 「趋势确认」——还有参考价值，但不该照着它进场。
 *
 * 注意这里**不再有「最后确认」那一行**。卡片改成当轮扫描的视图之后，
 * 每一张按定义就是这一轮算出来的，不存在「这张卡是不是过期状态」这个
 * 问题——那是旧的警报状态机（卡片能比扫描活得久）才需要回答的。
 */
function freshness(iso: string): "fresh" | "normal" | "stale" {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins <= 30) return "fresh";
  if (mins <= 240) return "normal";
  return "stale";
}

/**
 * livePrice 是 BingX 永续行情推送的最新成交价（见 useCardPrices），亚秒级。
 *
 * 拿不到时回落到扫描价，**涨跌幅要跟着一起回落**——用实时价配一个按扫描价
 * 算好的百分比，会拼出价格是新的、百分比是旧的卡片，两个数对不上账。
 */
export function AlertCard({
  card,
  livePrice = null,
}: {
  card: AlertCardData;
  livePrice?: number | null;
}) {
  const t = useTranslations("screener");
  const locale = useLocale();
  const { trigger, direction } = card;
  const price = livePrice ?? card.firstPrice;
  const pct = signedPct(card.firstPrice, price, direction);
  // peakPct 只在扫描时从 K 线算，而 pct 是实时的——不取 max 的话，价格在
  // 两次扫描之间创了新高时卡片会自相矛盾：「现在 +2.1%，最高到过 0.00%」。
  const peak = Math.max(card.peakPct, pct);

  // 实时穿线先变灰、划掉操作指令；服务端下一轮扫描确认后这张卡才真正消失。
  // 分两步而不是直接消失，是因为消失要等最多 15 分钟，而「别再按它操作」
  // 这件事你应该在一秒内就知道。
  const dead =
    card.invalidation !== null &&
    livePrice !== null &&
    isInvalidated(card.invalidation, livePrice, livePrice);

  const toneCls = toneFor(trigger);
  const dirCls = DIRECTION_CLASSES[direction];

  // 「X 前触发」和新鲜度用的是**信号真正发生的时刻**，不是 firstSeenAt。
  // 两者对场景卡是一回事，对点火卡不是：点火那根 K 线可能在我们扫到它之前
  // 就走完了（扫描 15 分钟一轮、K 线 30 分钟一根），用 firstSeenAt 会把一次
  // 半小时前的点火说成「刚刚」。firstSeenAt 仍然管首次价与累计涨跌——那两个
  // 数就该锚在我们第一次记录它的那一刻。
  const triggeredAt = new Date(
    trigger.type === "ignition" ? trigger.ignition.ignitedAt : trigger.scenario.triggeredAt
  ).toISOString();
  const fresh = freshness(triggeredAt);

  // 场景卡与点火卡在这三格上说的是不同的话，其余版式完全共用。
  let title: string;
  let verdict: string;
  let action: string;
  let trap = false;
  let strengthBadge: { bg: string; text: string; label: string } | null = null;
  if (trigger.type === "scenario") {
    const sc = trigger.scenario;
    trap = sc.trap;
    title = t(`scenarios.${sc.kind}.name`);
    action = t(`scenarios.${sc.kind}.action`);
    // 判定句用「结构位 + 两个变量的读数」拼，每个场景一句，见 i18n。
    verdict = t(`scenarios.${sc.kind}.reading`, {
      level: formatPrice(sc.structureLevel),
      cvdPct: formatPercent(sc.cvdPct),
      oiPct: formatPercent(sc.oiPct),
    });
    const cls = STRENGTH_CLASSES[sc.strength];
    strengthBadge = { ...cls, label: t(`strength.${sc.strength}`) };
  } else {
    const ig = trigger.ignition;
    title = t(`ignition.${ig.direction}.name`);
    action = t(`ignition.${ig.direction}.action`);
    verdict = t(`ignition.reading.${ig.direction}`, {
      level: formatPrice(ig.level),
      invalid: formatPrice(ig.invalidationPrice),
      distancePct: `${ig.distancePct.toFixed(2)}%`,
    });
  }

  return (
    <div
      className={cn(
        "rounded-md panel border-l-2 p-3.5 transition-opacity",
        toneCls.border,
        dead && "opacity-50"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-xs px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              dirCls.pillBg,
              dirCls.pillText
            )}
          >
            {directionLabel(direction, t)}
          </span>
          <span className="font-display text-sm font-semibold text-text-primary">
            {card.symbol.replace(/-USDT$/, "")}
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
          {fresh === "fresh" && (
            <span className="rounded-xs bg-gold/15 px-1 py-px text-[9px] font-semibold tracking-wider text-gold">
              {t("alerts.fresh_new")}
            </span>
          )}
          {fresh === "stale" && (
            <span className="rounded-xs bg-text-muted/15 px-1 py-px text-[9px] font-semibold tracking-wider text-text-muted">
              {t("alerts.fresh_stale")}
            </span>
          )}
          {triggeredLabel(triggeredAt, t)}
        </span>
      </div>

      <div className="mb-2.5 flex items-center gap-1.5">
        {/* 场景名做成填色徽章而不是裸的彩色文字：基调色此前只落在一条 2px
            边框和一行 13px 文字上，颜色面积太小，几张卡并排时看不出区别。
            徽章给了基调一块真正的surface，一眼就能认出这是哪一类场景。 */}
        <span
          className={cn(
            "rounded-xs px-1.5 py-0.5 font-display text-[12px] font-bold",
            toneCls.badgeBg,
            toneCls.text
          )}
        >
          {trigger.type === "ignition" && <Icon name="bolt" className="mr-0.5 inline h-3 w-3" />}
          {title}
        </span>
        {/* 陷阱标签跟着场景自身的基调色走（假顶=紫 / 假底=品红），
            写死一个紫会让品红卡片上出现两个对不上的"陷阱色"。 */}
        {trap && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", toneCls.text)}>
            <Icon name="alert" className="h-3 w-3" />
            {t("scenarios.trap_label")}
          </span>
        )}
        {strengthBadge && (
          <span
            className={cn(
              "rounded-xs px-1.5 py-0.5 text-[10px] font-semibold",
              strengthBadge.bg,
              strengthBadge.text
            )}
          >
            {strengthBadge.label}
          </span>
        )}
        {dead && (
          <span className="ml-auto rounded-xs bg-danger/15 px-1.5 py-px text-[10px] font-semibold text-danger">
            {t("alerts.invalidated")}
          </span>
        )}
      </div>

      <p
        className={cn(
          "mb-3 rounded-sm border bg-bg-tertiary px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary",
          toneCls.borderTint
        )}
      >
        {verdict}
      </p>

      <div
        className={cn(
          "mb-3 rounded-sm px-2.5 py-2 text-xs font-semibold",
          dirCls.actionBg,
          dirCls.actionText,
          dead && "line-through"
        )}
      >
        {action}
      </div>

      {/* 涨跌与价格并成一组：左边是「赚了多少」，右边是三个价格。
          原来大涨跌数字独占一整块、价格另占一块，两者其实回答的是同一个
          问题（这单现在怎么样了），拆成两块反而要读者来回看。 */}
      <div className="mb-3 flex items-end justify-between gap-3 rounded-sm bg-bg-tertiary px-3 py-2.5">
        <div>
          <div className={cn("tnum text-2xl font-bold leading-none", pct >= 0 ? "text-success" : "text-danger")}>
            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
          </div>
          <div className="mt-1 text-[10px] text-text-muted">
            {t("alerts.cumulative")} · {t("alerts.peak")} {peak.toFixed(2)}%
          </div>
        </div>
        <div className="space-y-0.5 text-right">
          {/* 实时价放第一行且最重：它是唯一每秒都在变的数，也是读者最先要找的。
              首次价与失效价是两个不动的结构位，退到次级。 */}
          <div className="tnum text-base font-semibold leading-none text-text-primary">
            {formatPrice(price)}
          </div>
          <div className="text-[10px] text-text-muted">{t("alerts.last_price")}</div>
          <div className="tnum pt-1 text-[10px] text-text-secondary">
            {t("alerts.first_price")} {formatPrice(card.firstPrice)}
          </div>
          {card.invalidation && (
            <div className={cn("tnum text-[10px]", dead ? "text-danger" : "text-text-secondary")}>
              {t("alerts.invalidation")} {formatPrice(card.invalidation.price)}
            </div>
          )}
        </div>
      </div>

      <FactorMeter factors={card.factors} fillClassName={toneCls.fill} className="mb-3" />

      {/* manage 不是可下单方向：按钮改成中性「查看」、链接不带 side，
          交易页自己决定默认方向。与主扫描表的操作列同一套处理。
          失效之后按钮也保留——你可能正持着这个仓要去平掉，
          这时候更需要一键跳过去，而不是把入口收走。 */}
      <Link
        href={
          direction === "manage"
            ? `/${locale}/trade?symbol=${card.symbol}&market=futures`
            : `/${locale}/trade?symbol=${card.symbol}&side=${direction}&market=futures`
        }
        className="block"
      >
        <Button
          variant={
            direction === "long" ? "green" : direction === "short" ? "red" : "secondary"
          }
          size="sm"
          className="min-h-[38px] w-full text-xs"
        >
          {direction === "manage" ? t("action_view") : t("alerts.trade")}
        </Button>
      </Link>
    </div>
  );
}
