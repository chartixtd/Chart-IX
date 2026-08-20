"use client";

import { useTranslations } from "next-intl";
import { cn, formatPrice, formatPercent } from "@/lib/utils";
import { FACTOR_MAX, SCAN_INTERVAL_MS } from "@/lib/screener/types";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { signedPct } from "@/lib/screener/alerts";
import { FactorStack } from "./FactorStack";
import { scenarioTone, readingKey, TONE_CLASSES, DIRECTION_CLASSES } from "./scenario-ui";

const FACTOR_LABELS = [
  ["oi", "OI"],
  ["cvd", "CVD"],
] as const;

// 接收 t 而不是硬编码文案——页面其余文案全部走 i18n，这里也不能例外
// （英文/马来语环境下直接冒出一个中文"刚刚"是真的会发生的 bug）。
// t 本身已经在组件里按 render 存在，这里只是把它当参数传进来，
// 不会额外产生开销大的对象。
function sinceLabel(iso: string, t: ReturnType<typeof useTranslations>): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("alerts.just_now");
  if (mins < 60) return t("alerts.minutes_ago", { n: mins });
  return t("alerts.hours_ago", { n: Math.round(mins / 60) });
}

/** direction/scenario.direction 三态 pill 的文案，manage 统一显示成"观望"。 */
function directionLabel(dir: "long" | "short" | "manage", t: ReturnType<typeof useTranslations>): string {
  if (dir === "long") return "LONG";
  if (dir === "short") return "SHORT";
  return t("scenarios.pill_manage");
}

/**
 * 新鲜度分档。**这套系统比一般行情工具更需要它**，因为信号天生带
 * 「出生延迟」：场景锚在已确认的摆动点上（PIVOT_N=5，要等 5 根 30 分钟
 * K 线走完才确认），所以警报弹出来的那一刻，触发它的结构事件至少已经
 * 是 2.5 小时前的事。不标出来，读者会把「刚触发」误读成「刚发生」。
 *
 * 4 小时这条线：这类结构事件的生命周期实测是几十分钟到几小时，
 * 叠上 2.5 小时的确认延迟，超过 4 小时的警报基本已经从「入场信号」
 * 退化成「趋势确认」——还有参考价值，但不该照着它进场。
 * 30 分钟 = 两个扫描间隔，够覆盖一次扫描漂移。
 */
function freshness(iso: string): "fresh" | "normal" | "stale" {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins <= 30) return "fresh";
  if (mins <= 240) return "normal";
  return "stale";
}

/**
 * 「最后确认」是不是已经旧到不正常。场景仍在时每轮扫描都会刷新
 * lastPriceAt，所以正常值应当在一个扫描间隔（15 分钟）以内。明显更旧
 * 意味着扫描断了，或者场景已经进入「连续 3 轮消失才关闭」的倒计时——
 * 两种都是读者需要立刻知道的状态，而「多久之前触发」回答不了它。
 * 留 1.5 倍余量，避免正常的调度漂移天天标红。
 */
function staleConfirm(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > SCAN_INTERVAL_MS * 1.5;
}

/** 触发时间、新鲜度、最后确认是三个不同的问题，分开显示。 */
function TimeMeta({ alert, t }: { alert: AlertRecord; t: ReturnType<typeof useTranslations> }) {
  const fresh = freshness(alert.triggeredAt);
  const confirmStale = staleConfirm(alert.lastPriceAt);
  return (
    <div className="flex flex-col items-end gap-0.5">
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
        {sinceLabel(alert.triggeredAt, t)} {t("alerts.triggered")}
      </span>
      <span className={cn("text-[10px]", confirmStale ? "text-danger" : "text-text-muted")}>
        {t("alerts.last_confirmed")}{" "}
        {alert.lastPriceAt ? sinceLabel(alert.lastPriceAt, t) : t("alerts.never_confirmed")}
      </span>
    </div>
  );
}

/**
 * livePrice 是 BingX 每 15 秒刷新的最新成交价（见 useLivePrices）。
 * 它优先于 alert.lastPrice —— 后者是**上一轮扫描**写进库里的价格，
 * 而扫描 15 分钟才一轮（受 CoinGlass 配额限制）。卡片上这一格标着
 * 「实时价格」，拿一个可能十几分钟前的数去填它是名不副实：实测
 * PUMP 现价 0.003279、库里 0.003247，差了 0.98%，而卡片上那个
 * ▼1.73% 是照着旧价算的。
 *
 * 拿不到实时价（BingX 抖动、或这个 symbol 不在永续列表里）就回落到
 * lastPrice，并且**涨跌幅要跟着一起回落**——用实时价配 currentPct
 * （服务端按 lastPrice 算的）会拼出一个自相矛盾的卡片：价格是新的，
 * 百分比是旧的，两个数对不上账。
 */
export function AlertCard({
  alert,
  livePrice = null,
}: {
  alert: AlertRecord;
  livePrice?: number | null;
}) {
  const t = useTranslations("screener");
  const shownPrice = livePrice ?? alert.lastPrice;
  const pct =
    livePrice === null
      ? (alert.currentPct ?? 0)
      : signedPct(alert.triggerPrice, livePrice, alert.direction);
  // peakPct 只在每轮扫描时落库，而 pct 现在是实时的——不取 max 的话，
  // 价格在两轮扫描之间创了新高时卡片会自相矛盾：「现在 +2.1%，最高到过
  // 0.00%」。「最高到过」问的是「触发以来最好到过哪儿」，此刻本身也算数。
  const shownPeak = alert.peakPct === null ? null : Math.max(alert.peakPct, pct);

  // 老警报（T22 之前触发、没有场景判定）：沿用简单卡片样式，不套用
  // 场景基调——scenario 为 null 时也没有判定句/操作文案/CVD-OI 标签
  // 这些场景专属信息可拼。
  if (!alert.scenario) {
    return (
      <div className="rounded-lg panel p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
                alert.direction === "long"
                  ? "bg-success/15 text-success"
                  : alert.direction === "short"
                    ? "bg-danger/15 text-danger"
                    : "bg-text-secondary/15 text-text-secondary"
              )}
            >
              {directionLabel(alert.direction, t)}
            </span>
            <span className="font-display text-sm font-semibold text-text-primary">
              {alert.symbol.replace(/-USDT$/, "")}
            </span>
          </div>
          <TimeMeta alert={alert} t={t} />
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
          {t("alerts.trigger_line", {
            score: alert.triggerScore,
            oi: alert.factors.oi,
            cvd: alert.factors.cvd,
          })}
        </p>

        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">
              {t("alerts.first_price")}
            </div>
            <div className="tnum text-sm text-text-secondary">{formatPrice(alert.triggerPrice)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">
              {t("alerts.last_price")}
            </div>
            <div className="tnum text-sm text-text-primary">
              {shownPrice === null ? "—" : formatPrice(shownPrice)}
            </div>
          </div>
        </div>

        <div className="mb-3 rounded-md bg-bg-tertiary px-3 py-2 text-center">
          <div className={cn("tnum text-xl font-bold", pct >= 0 ? "text-success" : "text-danger")}>
            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.cumulative")}
            {shownPeak !== null && (
              <span className="ml-1.5">
                · {t("alerts.peak")} {shownPeak.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          {FACTOR_LABELS.map(([key, label]) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <FactorStack factors={alert.factors} size="lg" only={key} />
              <span className="text-[10px] text-text-muted">{label}</span>
              <span className="tnum text-[10px] text-text-secondary">
                {alert.factors[key]}/{FACTOR_MAX[key]}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 有场景判定：按模板重做的六场景卡片。tone 管左边框/场景名/分值条颜色，
  // scenario.direction 管顶部 pill 与操作指令条颜色——两套配色分开是故意的，
  // 见 scenario-ui.ts DIRECTION_CLASSES 顶部注释。
  const { scenario } = alert;
  const tone = scenarioTone(scenario.kind);
  const toneCls = TONE_CLASSES[tone];
  const dirCls = DIRECTION_CLASSES[scenario.direction];
  const pricePct = ((scenario.swingNow - scenario.swingPrev) / scenario.swingPrev) * 100;
  const verdict = t(`scenarios.reading.${readingKey(scenario.kind, scenario.side)}`, {
    price: formatPrice(scenario.swingNow),
    pricePct: formatPercent(pricePct),
    cvdPct: formatPercent(scenario.cvdPct),
    oiPct: formatPercent(scenario.oiPct),
  });

  return (
    <div className={cn("rounded-lg panel border-l-2 p-3.5", toneCls.border)}>
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
            {alert.symbol.replace(/-USDT$/, "")}
          </span>
        </div>
        <TimeMeta alert={alert} t={t} />
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
      </div>

      <p className="mb-3 rounded-md bg-bg-tertiary px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary">
        {verdict}
      </p>

      <div
        className={cn(
          "mb-3 rounded-md px-2.5 py-2 text-xs font-semibold",
          dirCls.actionBg,
          dirCls.actionText
        )}
      >
        {t(`scenarios.${scenario.kind}.action`)}
      </div>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.first_price")}
          </div>
          <div className="tnum text-sm text-text-secondary">{formatPrice(alert.triggerPrice)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.last_price")}
          </div>
          <div className="tnum text-sm text-text-primary">
            {shownPrice === null ? "—" : formatPrice(shownPrice)}
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-md bg-bg-tertiary px-3 py-2 text-center">
        <div className={cn("tnum text-xl font-bold", pct >= 0 ? "text-success" : "text-danger")}>
          {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          {t("alerts.cumulative")}
          {shownPeak !== null && (
            <span className="ml-1.5">
              · {t("alerts.peak")} {shownPeak.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        {FACTOR_LABELS.map(([key, label]) => (
          <div key={key} className="flex flex-col items-center gap-1">
            <FactorStack factors={alert.factors} size="lg" only={key} fillClassName={toneCls.fill} />
            <span className="text-[10px] text-text-muted">{label}</span>
            <span className={cn("text-[10px] font-medium", toneCls.text)}>
              {t(`scenarios.${key}_tag.${scenario.kind}`)}
            </span>
            <span className="tnum text-[10px] text-text-secondary">
              {alert.factors[key]}/{FACTOR_MAX[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
