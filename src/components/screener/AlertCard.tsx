"use client";

import { useTranslations } from "next-intl";
import { cn, formatPrice, formatPercent } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { ScenarioCard } from "@/lib/screener/cards";
import { signedPct } from "@/lib/screener/cards";
import { isInvalidated } from "@/lib/screener/invalidation";
import { FactorStack } from "./FactorStack";
import { scenarioTone, readingKey, TONE_CLASSES, DIRECTION_CLASSES } from "./scenario-ui";

const FACTOR_LABELS = [
  ["oi", "OI"],
  ["cvd", "CVD"],
] as const;

// 接收 t 而不是硬编码文案——页面其余文案全部走 i18n，这里也不能例外
// （英文/马来语环境下直接冒出一个中文"刚刚"是真的会发生的 bug）。
function sinceLabel(iso: string, t: ReturnType<typeof useTranslations>): string {
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
  card: ScenarioCard;
  livePrice?: number | null;
}) {
  const t = useTranslations("screener");
  const { scenario } = card;
  const price = livePrice ?? card.firstPrice;
  const pct = signedPct(card.firstPrice, price, scenario.direction);
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

  const tone = scenarioTone(scenario.kind);
  const toneCls = TONE_CLASSES[tone];
  const dirCls = DIRECTION_CLASSES[scenario.direction];
  const fresh = freshness(card.firstSeenAt);
  const pricePct = ((scenario.swingNow - scenario.swingPrev) / scenario.swingPrev) * 100;
  const verdict = t(`scenarios.reading.${readingKey(scenario.kind, scenario.side)}`, {
    price: formatPrice(scenario.swingNow),
    pricePct: formatPercent(pricePct),
    cvdPct: formatPercent(scenario.cvdPct),
    oiPct: formatPercent(scenario.oiPct),
  });

  return (
    <div
      className={cn(
        "rounded-lg panel border-l-2 p-3.5 transition-opacity",
        toneCls.border,
        dead && "opacity-50"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              dirCls.pillBg,
              dirCls.pillText
            )}
          >
            {directionLabel(scenario.direction, t)}
          </span>
          <span className="font-display text-sm font-semibold text-text-primary">
            {card.symbol.replace(/-USDT$/, "")}
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
          {fresh === "fresh" && (
            <span className="rounded-sm bg-gold/15 px-1 py-px text-[9px] font-semibold tracking-wider text-gold">
              {t("alerts.fresh_new")}
            </span>
          )}
          {fresh === "stale" && (
            <span className="rounded-sm bg-text-muted/15 px-1 py-px text-[9px] font-semibold tracking-wider text-text-muted">
              {t("alerts.fresh_stale")}
            </span>
          )}
          {sinceLabel(card.firstSeenAt, t)} {t("alerts.triggered")}
        </span>
      </div>

      <div className="mb-2.5 flex items-center gap-1.5">
        <span className={cn("font-display text-[13px] font-bold", toneCls.text)}>
          {t(`scenarios.${scenario.kind}.name`)}
        </span>
        {scenario.trap && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-purple-400">
            <span aria-hidden>⚠</span>
            {t("scenarios.trap_label")}
          </span>
        )}
        {dead && (
          <span className="ml-auto rounded-sm bg-danger/15 px-1.5 py-px text-[10px] font-semibold text-danger">
            {t("alerts.invalidated")}
          </span>
        )}
      </div>

      <p className="mb-3 rounded-md bg-bg-tertiary px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary">
        {verdict}
      </p>

      <div
        className={cn(
          "mb-3 rounded-md px-2.5 py-2 text-xs font-semibold",
          dirCls.actionBg,
          dirCls.actionText,
          dead && "line-through"
        )}
      >
        {t(`scenarios.${scenario.kind}.action`)}
      </div>

      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.first_price")}
          </div>
          <div className="tnum text-sm text-text-secondary">{formatPrice(card.firstPrice)}</div>
        </div>
        {/* 失效价紧挨着首次价：两个都是「结构位」，而右边那个是实时的市场状态。
            这一格让卡片从「一个信号」变成「一个完整的交易框架」——进场理由、
            失效位置、实时进度，一眼全在。而且这个止损位不是我们编的建议，
            就是信号本身锚定的那个摆动点。 */}
        {card.invalidation && (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">
              {t("alerts.invalidation")}
            </div>
            <div className={cn("tnum text-sm", dead ? "text-danger" : "text-text-secondary")}>
              {formatPrice(card.invalidation.price)}
            </div>
          </div>
        )}
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.last_price")}
          </div>
          <div className="tnum text-sm text-text-primary">{formatPrice(price)}</div>
        </div>
      </div>

      <div className="mb-3 rounded-md bg-bg-tertiary px-3 py-2 text-center">
        <div className={cn("tnum text-xl font-bold", pct >= 0 ? "text-success" : "text-danger")}>
          {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          {t("alerts.cumulative")}
          <span className="ml-1.5">
            · {t("alerts.peak")} {peak.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        {FACTOR_LABELS.map(([key, label]) => (
          <div key={key} className="flex flex-col items-center gap-1">
            <FactorStack factors={card.factors} size="lg" only={key} fillClassName={toneCls.fill} />
            <span className="text-[10px] text-text-muted">{label}</span>
            <span className={cn("text-[10px] font-medium", toneCls.text)}>
              {card.factors[key]}/{FACTOR_MAX[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
