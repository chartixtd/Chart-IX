import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Scenario, ScenarioDirection } from "./factors/scenario";
import type { FactorBreakdown, ScannerRow } from "./types";
import { invalidationLine, isInvalidated } from "./invalidation";
import type { InvalidationLine } from "./invalidation";

/**
 * 备忘的钥匙 = 一个「结构事件」的身份。
 *
 * 带上 swingNow 是关键：场景锚在摆动点上，锚点没变就是同一件事。
 * 这样币暂时掉出前 20 又回来时，首次价与累计变化能接上而不是重置成 0；
 * 而摆动点一旦更新（结构真的变了），钥匙自然不同，重新计时。
 *
 * swingNow 直接进字符串而不做四舍五入：它来自 K 线的最高/最低价，
 * 是精确值不是算出来的；取整反而会让两个相邻的摆动点撞成同一把钥匙。
 */
export function memoKey(symbol: string, s: Scenario): string {
  return `${symbol}|${s.kind}|${s.direction}|${s.side}|${s.swingNow}`;
}

export interface ScenarioMemo {
  key: string;
  symbol: string;
  firstSeenAt: string;
  firstPrice: number;
}

export interface ScenarioCard {
  key: string;
  symbol: string;
  coin: string;
  scenario: Scenario;
  factors: FactorBreakdown;
  /** OI + CVD，卡片排序用 */
  total: number;
  /** 首次看到这个结构事件的时刻与价格，来自备忘 */
  firstSeenAt: string;
  firstPrice: number;
  /** 首次以来的最好成绩，%（顺方向）。从 K 线算，不落库 */
  peakPct: number;
  /** 失效线；锚点价格非法时为 null */
  invalidation: InvalidationLine | null;
}

/** 触发价 → 现价的顺方向涨跌幅。做空时符号翻过来，跌了才是正的。 */
export function signedPct(from: number, to: number, direction: ScenarioDirection): number {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return 0;
  const raw = ((to - from) / from) * 100;
  return direction === "short" ? -raw : raw;
}

/**
 * 从 K 线里取出 `sinceMs` 之后的最高价与最低价。
 *
 * 用区间极值而不是收盘价，是失效判定与峰值计算共同的要求：插针也算数。
 * 止损被扫了就是被扫了，用收盘价判会漏掉真实发生过的穿越，而那种漏判
 * 恰恰发生在行情最剧烈、这张卡最需要被撤下的时候。
 *
 * 一根都没有时返回 null（比如备忘的时间戳比整段序列还新——刚开的卡）。
 * 调用方对 null 的正确处理是「用当前价代替」，而不是当成没穿线。
 */
export function extremesSince(
  bars: CoinGlassPriceBar[],
  sinceMs: number
): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.time < sinceMs) continue;
    const h = parseFloat(b.high);
    const l = parseFloat(b.low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low };
}

export interface BuildCardInput {
  row: ScannerRow;
  priceBars: CoinGlassPriceBar[];
  /** 已有的备忘；没有就是第一次看到这个结构事件 */
  memo: ScenarioMemo | undefined;
  /** 当前时刻，ms。注入而不是直接读 Date.now()，测试才能构造确定的场景 */
  now: number;
}

export interface BuildCardResult {
  card: ScenarioCard | null;
  /** 需要新建的备忘（这个结构事件第一次被看到）。无则 undefined */
  newMemo?: ScenarioMemo;
}

/**
 * 把一行扫描结果变成一张卡片。三种结果：
 *
 *   · 没有场景 → 没有卡（大多数币）
 *   · 有场景、失效线没被打穿 → 出卡
 *   · 有场景、但价格已经打穿失效线 → **没有卡**
 *
 * 第三种是这套设计最要紧的一处：场景锚在**已确认的**摆动点上，而摆动点
 * 要 2.5 小时才确认。价格早已跌穿那个底、而系统还在显示「反手做多」的
 * 空窗期，正是失效线要补上的。
 *
 * **失效之后不删备忘。** 删了的话下一轮 firstSeenAt 会重置成「现在」，
 * 失效判定只看得到刚才那几分钟的 K 线、判不出穿线，这张卡就会原地复活。
 * 备忘留着，穿线的事实就一直成立，卡片保持消失——直到摆动点更新（钥匙
 * 变了，本来就是新事件）或备忘按时间被清理掉。
 */
export function buildCard({ row, priceBars, memo, now }: BuildCardInput): BuildCardResult {
  const { scenario } = row;
  if (!scenario) return { card: null };

  const key = memoKey(row.symbol, scenario);
  const firstSeenAt = memo?.firstSeenAt ?? new Date(now).toISOString();
  const firstPrice = memo?.firstPrice ?? row.price;
  const newMemo = memo ? undefined : { key, symbol: row.symbol, firstSeenAt, firstPrice };

  const line = invalidationLine(scenario);
  // 刚开的卡在序列里还没有属于它的 K 线，用当前价顶上——它同样能表达
  // 「此刻有没有穿线」，只是覆盖的区间是一个点。
  const ext = extremesSince(priceBars, new Date(firstSeenAt).getTime()) ?? {
    high: row.price,
    low: row.price,
  };
  if (line && isInvalidated(line, ext.high, ext.low)) return { card: null, newMemo };

  // 峰值取区间内对这个方向最有利的那一端：做多看最高价，做空看最低价。
  // 再和当前价取 max，是因为 K 线是 30 分钟粒度，最后一根还没走完时
  // 当前价可能已经超出它的区间。
  const best = scenario.direction === "short" ? ext.low : ext.high;
  const peakPct = Math.max(
    0,
    signedPct(firstPrice, best, scenario.direction),
    signedPct(firstPrice, row.price, scenario.direction)
  );

  return {
    card: {
      key,
      symbol: row.symbol,
      coin: row.coin,
      scenario,
      factors: row.factors,
      total: row.total,
      firstSeenAt,
      firstPrice,
      peakPct,
      invalidation: line,
    },
    newMemo,
  };
}

/**
 * 卡片排序：总分从高到低，最强的信号在最上面。
 *
 * 曾经按触发时间倒序（新的在上）。改成按分数，是因为你打开警报栏想问的
 * 是「现在最值得看的是哪个」，而不是「最近发生了什么」——后者由卡片上的
 * NEW 徽章回答就够了。
 *
 * 分数相同时按 symbol，保证顺序稳定可复现。
 */
export function sortCards(cards: ScenarioCard[]): ScenarioCard[] {
  return [...cards].sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));
}
