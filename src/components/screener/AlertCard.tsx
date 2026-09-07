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
import { AlertSpark } from "./AlertSpark";
import { toneFor, DIRECTION_CLASSES } from "./scenario-ui";

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
 * 「出生延迟」：场景锚在已确认的摆动点上（PIVOT_N=1，要等 1 根 30 分钟
 * K 线走完才确认），所以卡片出现的那一刻，触发它的结构事件至少已经是
 * 30 分钟前的事。不标出来，读者会把「刚出现」误读成「刚发生」。
 *
 * 4 小时这条线：这类结构事件的生命周期实测是几十分钟到几小时，叠上
 * 30 分钟的确认延迟，超过 4 小时的卡片基本已经从「入场信号」退化成
 * 「趋势确认」——还有参考价值，但不该照着它进场。
 */
function freshness(iso: string): "fresh" | "normal" | "stale" {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins <= 30) return "fresh";
  if (mins <= 240) return "normal";
  return "stale";
}

/**
 * 警报卡（第二版）。
 *
 * 第一版把三个价格排成三格数字带，读者要在脑子里自己把它们摆成一张图。
 * 这一版直接给图：一条 24 小时的永续价格曲线（AlertSpark），叠首次警报价
 * 的中性虚线与失效价的红虚线，现价离哪条线多远一眼可见。
 *
 * 版式从上到下只有一种节奏——每一层都是左右一对：
 *   币名 + 方向 ｜ 多久前触发
 *   顺方向涨跌（主角）｜ 实时价
 *   曲线 ＋ 两条参考线的图例
 *   操作指令（先说做什么）｜ 判读（再说为什么）
 *   OI ｜ CVD
 *   唯一的按钮
 * 场景基调色只出现在左边框、曲线和那条细线上：颜色是标注，不是填充。
 *
 * livePrice 是 BingX 永续行情推送的最新成交价（见 useCardPrices），亚秒级。
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

  // 两种「这张卡别再按它操作了」：
  //   expired —— 服务端已经算不出这个信号了（失效/结构变了/点火过期）。
  //     卡片不立刻消失而是灰着留一段时间，是为了让 Telegram 推过来的币
  //     在页面上找得到——推的那一刻它一定在，几十分钟后就不一定了。
  //   dead —— 实时价刚刚穿了失效线，但服务端下一轮（最多 15 分钟）才会确认。
  //     先变灰是因为「别再按它操作」这件事应该在一秒内知道，不该等一刻钟。
  const dead =
    card.expired ||
    (card.invalidation !== null &&
      livePrice !== null &&
      isInvalidated(card.invalidation, livePrice, livePrice));

  // 结束标签怎么写、用什么色：
  //   实时穿线（服务端还没确认）→ 红「已失效」。
  //   服务端结束 → 按它记下的原因分：穿线也是红的；条件已变 / 本轮未扫 /
  //     数据缺失是灰的。红 = 市场证伪了它，灰 = 系统不再算它。
  //   旧 payload 里没带原因的灰卡 → 退回「已结束」，不猜。
  // 原因只对服务端结束的卡有意义，实时穿线那一路没有原因字段可读。
  const reason = card.expired ? card.expiredReason : undefined;
  const endedLabel = !card.expired
    ? t("alerts.invalidated")
    : reason
      ? t(`alerts.ended_reason.${reason}`)
      : t("alerts.ended");
  const endedDanger = !card.expired || reason === "invalidated";

  const toneCls = toneFor(trigger);
  const dirCls = DIRECTION_CLASSES[direction];

  // 「X 前触发」= **这张卡什么时候出现的**，两种触发源取的东西不同：
  //   点火卡 → ignitedAt（点火那根 K 线的时刻），比 firstSeenAt 准：点火那根
  //     可能在我们扫到它之前就走完了，用 firstSeenAt 会把半小时前说成「刚刚」。
  //   场景卡 → firstSeenAt。结构锚点（scenario.triggeredAt）可以是一天前的事，
  //     它回答的是「结构在哪儿成形」，不是「这个警报什么时候来的」。
  const triggeredAt =
    trigger.type === "ignition"
      ? new Date(trigger.ignition.ignitedAt).toISOString()
      : card.firstSeenAt;
  const fresh = freshness(triggeredAt);

  // 场景卡与点火卡在这两格上说的是不同的话，其余版式完全共用。
  //
  // 场景名与强度徽章都**不显示**：前者读起来像一个已经读懂市场的结论，而实测
  // 不同场景之间的方向准确度全部落在 50% 附近；后者暗示了一个可信度排序，
  // 而各强度档的胜率同样都是 50% 上下。verdict 用大白话说**发生了什么**。
  let verdict: string;
  let action: string;
  let trap = false;
  if (trigger.type === "scenario") {
    const sc = trigger.scenario;
    trap = sc.trap;
    // strength / oiState 一并传进去：文案里凡是描述 OI 或强度的**定语**，
    // 都用 ICU select 从这两个值选词，而不是写死。详见 factors/scenario.ts。
    const vars = {
      level: formatPrice(sc.structureLevel),
      cvdPct: formatPercent(sc.cvdPct),
      oiPct: formatPercent(sc.oiPct),
      oiState: sc.oiState,
      strength: sc.strength,
    };
    action = t(`scenarios.${sc.kind}.action`, vars);
    verdict = t(`scenarios.${sc.kind}.reading`, vars);
  } else {
    const ig = trigger.ignition;
    action = t(`ignition.${ig.direction}.action`);
    verdict = t(`ignition.reading.${ig.direction}`, {
      level: formatPrice(ig.level),
      invalid: formatPrice(ig.invalidationPrice),
      distancePct: `${ig.distancePct.toFixed(2)}%`,
    });
  }

  const coin = card.symbol.replace(/-USDT$/, "");

  return (
    <article
      className={cn(
        "ink flex flex-col rounded-lg border-l-2 p-5 transition-opacity",
        toneCls.border,
        dead && "opacity-50"
      )}
    >
      {/* 币名 + 方向 ｜ 多久前触发 */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-2xl font-light tracking-tight text-text-primary">{coin}</span>
          <span
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
              dirCls.pillBg,
              dirCls.pillText
            )}
          >
            {directionLabel(direction, t)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1.5 text-[11px] text-text-muted">
          {!dead && fresh === "fresh" && (
            <span className="rounded-sm border border-gold/40 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-gold">
              {t("alerts.fresh_new")}
            </span>
          )}
          {!dead && fresh === "stale" && (
            <span className="rounded-sm border border-border-hover px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              {t("alerts.fresh_stale")}
            </span>
          )}
          <span className="whitespace-nowrap">{triggeredLabel(triggeredAt, t)}</span>
          {/* 「已结束 / 已失效」跟新鲜度徽章同属「这张卡的状态」，放同一行；
              单独另起一行会在抬头下面留一条只有右端有字的空行。dead 时新鲜度
              徽章不再显示——已经结束的信号无所谓新不新。 */}
          {dead && (
            <span
              className={cn(
                "rounded-sm border px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em]",
                endedDanger ? "border-danger/40 text-danger" : "border-border-hover text-text-muted"
              )}
            >
              {endedLabel}
            </span>
          )}
        </div>
      </header>

      {/* 陷阱标签跟着场景自身的基调色走（假顶=紫 / 假底=品红），写死一个紫
          会让品红卡片上出现两个对不上的"陷阱色"。 */}
      {trap && (
        <div className={cn("mt-3 inline-flex items-center gap-1 text-[11px] font-semibold", toneCls.text)}>
          <Icon name="alert" className="h-3.5 w-3.5" />
          {t("scenarios.trap_label")}
        </div>
      )}

      {/* 顺方向涨跌（主角）｜ 实时价 */}
      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className={cn("numeral text-[2.5rem] leading-none", pct >= 0 ? "text-success" : "text-danger")}>
            {formatPercent(pct)}
          </div>
          <div className="mt-2 font-mono text-[10px] tabular-nums text-text-muted">
            {t("alerts.peak")} {formatPercent(peak)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-xl tabular-nums leading-none text-text-primary">{formatPrice(price)}</div>
          <div className="eyebrow mt-2 text-[10px]">{t("alerts.last_price")}</div>
        </div>
      </div>

      {/* 24 小时曲线 + 两条参考线。已结束的卡曲线退成灰色，只剩红虚线还在说话 */}
      <AlertSpark
        className="mt-4 h-16"
        symbol={card.symbol}
        firstPrice={card.firstPrice}
        invalidation={card.invalidation}
        toneClassName={dead ? "text-text-muted" : toneCls.text}
      />
      {/* 图例：短虚线样本 + 标签 + 值，与图上的两条线一一对应 */}
      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-text-secondary">
          <i aria-hidden className="inline-block w-3 border-t border-dashed border-text-secondary/70" />
          <span className="text-text-muted">{t("alerts.first_price")}</span>
          {formatPrice(card.firstPrice)}
        </span>
        {card.invalidation && (
          <span className={cn("inline-flex items-center gap-1.5", dead ? "text-danger" : "text-text-secondary")}>
            <i aria-hidden className="inline-block w-3 border-t border-dashed border-danger/70" />
            <span className="text-text-muted">{t("alerts.invalidation")}</span>
            {formatPrice(card.invalidation.price)}
          </span>
        )}
      </div>

      {/* 先说做什么，再说为什么。上面那条细线是场景基调色。
          失效之后指令划掉但保留——你可能正持着这个仓，需要知道它当初说的是什么。 */}
      <div className={cn("mt-5 border-t pt-4", toneCls.borderTint)}>
        <p className={cn("text-[13px] font-semibold leading-snug", dirCls.actionText, dead && "line-through")}>
          {action}
        </p>
        {/* 指令被划掉了，紧跟着说清楚**为什么**。一张失效线画得很显眼的卡打着
            「已结束」，读的人多半会以为是碰线了——而多数情况恰恰不是。 */}
        {reason && (
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {t(`alerts.ended_detail.${reason}`, {
              price: card.invalidation ? formatPrice(card.invalidation.price) : "—",
            })}
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{verdict}</p>
      </div>

      <FactorMeter layout="pair" factors={card.factors} fillClassName={toneCls.fill} className="mt-5" />

      {/* manage 不是可下单方向：按钮改成中性「查看」、链接不带 side，
          交易页自己决定默认方向。与主扫描表的操作列同一套处理。
          失效之后按钮也保留——你可能正持着这个仓要去平掉，这时候更需要一键跳过去。 */}
      <Link
        href={
          direction === "manage"
            ? `/${locale}/trade?symbol=${card.symbol}&market=futures`
            : `/${locale}/trade?symbol=${card.symbol}&side=${direction}&market=futures`
        }
        className="mt-5 block"
      >
        <Button
          variant={direction === "long" ? "green" : direction === "short" ? "red" : "secondary"}
          size="sm"
          className="h-10 w-full text-xs uppercase tracking-[0.14em]"
        >
          {direction === "manage"
            ? t("action_view")
            : direction === "long"
              ? t("action_long")
              : t("action_short")}
        </Button>
      </Link>
    </article>
  );
}
