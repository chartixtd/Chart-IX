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
 * 警报卡（Ink & Gilt 版）。
 *
 * 上一版是「盒子里套盒子」：判读一块底色、操作一块底色、价格一块底色，
 * 三块灰底叠在一张灰卡里，每块都在争注意力。这一版把结构交给发丝线：
 *   抬头（币名 + 方向 + 时间）与大涨跌数并置 → 一条场景基调色的细线 →
 *   判读正文 → 操作指令 → 三格价格刻度带 → 因子读数 → 唯一的操作按钮。
 * 场景基调色只出现在左边框与那条细线上：颜色是标注，不是填充。
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

  const toneCls = toneFor(trigger);
  const dirCls = DIRECTION_CLASSES[direction];

  // 「X 前触发」= **这张卡什么时候出现的**，两种触发源取的东西不同：
  //
  //   点火卡 → ignitedAt（点火那根 K 线的时刻）。它有上限（最多 8 根 = 4 小时），
  //     而且比 firstSeenAt 准：点火那根可能在我们扫到它之前就走完了
  //     （扫描 15 分钟一轮、K 线 30 分钟一根），用 firstSeenAt 会把一次
  //     半小时前的点火说成「刚刚」。
  //
  //   场景卡 → firstSeenAt。**这里曾经也用结构锚点（scenario.triggeredAt），
  //     那是错的**：场景锚在已确认的摆动点或被扫的 SSL/BSL 上，它可以是一天前
  //     的事——线上实测锚点在 7–22 小时前，而卡片是 6 分钟前才出现的，
  //     卡上却写着「22小时前触发」。锚点回答的是「结构在哪儿成形」，
  //     不是「这个警报什么时候来的」，而后者才是这行字要答的问题。
  const triggeredAt =
    trigger.type === "ignition"
      ? new Date(trigger.ignition.ignitedAt).toISOString()
      : card.firstSeenAt;
  const fresh = freshness(triggeredAt);

  // 场景卡与点火卡在这两格上说的是不同的话，其余版式完全共用。
  //
  // 场景名（「增仓型底背离」这类）与强度徽章都**不显示**：前者读起来像一个
  // 已经读懂市场的结论，而实测不同场景之间的方向准确度全部落在 50% 附近、
  // 彼此区分不开；后者暗示了一个可信度排序，而各强度档的胜率同样都是 50%
  // 上下。verdict 用大白话说**发生了什么**，信息量一样，但不冒充结论。
  // i18n 的 scenarios.*.name 没删——事后归因统计要按场景名分组。
  let verdict: string;
  let action: string;
  let trap = false;
  if (trigger.type === "scenario") {
    const sc = trigger.scenario;
    trap = sc.trap;
    // strength / oiState 一并传进去：文案里凡是描述 OI 或强度的**定语**，
    // 都用 ICU select 从这两个值选词，而不是写死。写死过三次，三次都不报错，
    // 只是在骗读的人。详见 factors/scenario.ts 里 Scenario.oiState 的注释。
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
      {/* 抬头：左边是这是什么（币、方向、多久前），右边是它现在怎么样了（顺方向涨跌）。
          两者是这张卡最先要回答的两个问题，所以并置在同一行、同一基线。 */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-xl font-medium tracking-tight text-text-primary">{coin}</span>
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
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            {fresh === "fresh" && (
              <span className="rounded-sm border border-gold/40 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-gold">
                {t("alerts.fresh_new")}
              </span>
            )}
            {fresh === "stale" && (
              <span className="rounded-sm border border-border-hover px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                {t("alerts.fresh_stale")}
              </span>
            )}
            <span>{triggeredLabel(triggeredAt, t)}</span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className={cn("numeral text-[2rem] leading-none", pct >= 0 ? "text-success" : "text-danger")}>
            {formatPercent(pct)}
          </div>
          <div className="mt-2 font-mono text-[10px] tabular-nums text-text-muted">
            {t("alerts.peak")} {formatPercent(peak)}
          </div>
        </div>
      </header>

      {/* 状态行：只剩「陷阱」与「已结束 / 已失效」。两个都没有时整行不渲染。
          陷阱标签跟着场景自身的基调色走（假顶=紫 / 假底=品红），写死一个紫
          会让品红卡片上出现两个对不上的"陷阱色"。 */}
      {(trap || dead) && (
        <div className="mt-4 flex items-center gap-2">
          {trap && (
            <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", toneCls.text)}>
              <Icon name="alert" className="h-3.5 w-3.5" />
              {t("scenarios.trap_label")}
            </span>
          )}
          {dead && (
            <span
              className={cn(
                "ml-auto rounded-sm border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.12em]",
                card.expired ? "border-border-hover text-text-muted" : "border-danger/40 text-danger"
              )}
            >
              {card.expired ? t("alerts.ended") : t("alerts.invalidated")}
            </span>
          )}
        </div>
      )}

      {/* 判读正文。上面那条细线是场景基调色——颜色在这里是标注，不是填充。 */}
      <p className={cn("mt-5 border-t pt-4 text-xs leading-relaxed text-text-secondary", toneCls.borderTint)}>
        {verdict}
      </p>

      {/* 操作指令：方向色文字，不再是一块填色。失效之后划掉，但保留——
          你可能正持着这个仓，需要知道它当初说的是什么。 */}
      <p className={cn("mt-3 text-[13px] font-semibold leading-snug", dirCls.actionText, dead && "line-through")}>
        {action}
      </p>

      {/* 三格价格刻度带：实时价最重（唯一每秒在变的数），首次价与失效价是
          两个不动的结构位，退到次级。发丝线分格，不用底色块。 */}
      <dl
        className={cn(
          "mt-5 grid gap-px border-y border-border-default bg-border-default",
          card.invalidation ? "grid-cols-3" : "grid-cols-2"
        )}
      >
        <div className="bg-bg-secondary py-3 pr-3">
          <dt className="eyebrow">{t("alerts.last_price")}</dt>
          <dd className="mt-2 font-mono text-sm tabular-nums text-text-primary">{formatPrice(price)}</dd>
        </div>
        <div className="bg-bg-secondary px-3 py-3">
          <dt className="eyebrow">{t("alerts.first_price")}</dt>
          <dd className="mt-2 font-mono text-sm tabular-nums text-text-secondary">{formatPrice(card.firstPrice)}</dd>
        </div>
        {card.invalidation && (
          <div className="bg-bg-secondary py-3 pl-3">
            <dt className="eyebrow">{t("alerts.invalidation")}</dt>
            <dd className={cn("mt-2 font-mono text-sm tabular-nums", dead ? "text-danger" : "text-text-secondary")}>
              {formatPrice(card.invalidation.price)}
            </dd>
          </div>
        )}
      </dl>

      <FactorMeter factors={card.factors} fillClassName={toneCls.fill} className="mt-5" />

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
        className="mt-6 block"
      >
        <Button
          variant={direction === "long" ? "green" : direction === "short" ? "red" : "secondary"}
          size="sm"
          className="h-10 w-full text-xs uppercase tracking-[0.14em]"
        >
          {/* 按钮文案直接说方向（做多 / 做空）。manage 仍然是中性的「查看」——
              它按定义就不是一个可下单方向，给它安一个方向词等于凭空造一个
              系统没给出的结论。 */}
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
