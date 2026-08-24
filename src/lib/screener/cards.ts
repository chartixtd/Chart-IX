import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Scenario, ScenarioDirection } from "./factors/scenario";
import type { FactorBreakdown, ScannerRow } from "./types";
import type { Ignition } from "./ignition";
import { invalidationLine, ignitionLine } from "./invalidation";
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

/**
 * 点火事件的钥匙。锚在 `ignitedAt`（点火那根 K 线的时刻）而不是 level。
 *
 * 用 level 会有个隐蔽的后果：回看窗口每走一根就往前滚一格，level 跟着变，
 * 于是同一次突破每半小时换一把钥匙——卡片的首次价和计时每轮重置，
 * 「累计 / 峰值」永远是 0，警报栏里全是「刚刚触发」。ignitedAt 在同一次
 * 点火期间是固定的（见 detectIgnition 的第 ② 步），钥匙才稳得住。
 */
export function ignitionMemoKey(symbol: string, ig: Ignition): string {
  return `${symbol}|ignition|${ig.direction}|${ig.ignitedAt}`;
}

export interface ScenarioMemo {
  key: string;
  symbol: string;
  firstSeenAt: string;
  firstPrice: number;
}

/**
 * 一张卡片是被什么触发的。
 *
 * 加上 ignition 这一支，是因为选币口径翻成「最安静」之后，六场景几乎判不
 * 出来了——它的第一道门是「价格创了新极值且至少差 1%」，而安静的币正在
 * 区间里横盘，按定义就不创新极值。实测（BingX 真实 K 线，流动性前 200
 * 分两端各 25 个）：最吵的一组 48% 能过这道门，最安静的一组只有 8%。
 *
 * 所以不是场景判定坏了，是**选币和警报两边要的东西相反**：主表专挑还没动
 * 的币，六场景专认已经动过的币。点火补的正是这个缺口——它只要求「收盘价
 * 越过前 6 小时区间」，没有确认延迟，而且安静的币突破区间恰恰就是
 * 「大动作刚启动」本身。
 */
export type CardTrigger =
  | { type: "scenario"; scenario: Scenario }
  | { type: "ignition"; ignition: Ignition };

export interface AlertCardData {
  key: string;
  symbol: string;
  coin: string;
  trigger: CardTrigger;
  /** 操作方向。点火向上 = long、向下 = short；场景直接用它自己的 direction */
  direction: ScenarioDirection;
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
  card: AlertCardData | null;
  /** 需要新建的备忘（这个结构事件第一次被看到）。无则 undefined */
  newMemo?: ScenarioMemo;
}

/**
 * 决定这一行由什么触发卡片。**场景优先于点火。**
 *
 * 两者同时成立时只出一张卡：场景把「资金流与持仓在这段行情里做了什么」
 * 也说清楚了，是严格更多的信息，而点火只说「突破了」。同一个币出两张卡
 * 只会让人以为是两个独立信号。
 *
 * 实际分布上这个优先级几乎不会被用到——安静的币判不出场景（见 CardTrigger
 * 的注释），所以警报栏里绝大多数会是点火卡。
 */
function pickTrigger(row: ScannerRow): CardTrigger | null {
  if (row.scenario) return { type: "scenario", scenario: row.scenario };
  if (row.ignition) return { type: "ignition", ignition: row.ignition };
  return null;
}

/**
 * 把一行扫描结果变成一张卡片。
 *
 * **这里不做失效判定。** 场景那一路在流水线的行级做（pipeline.ts 调
 * scenarioInvalidated），点火那一路在 detectIgnition 内部做（价格收回区间
 * 就返回 null）。两条路都是「走到这儿的都还活着」，所以这里只管展示。
 * 放在一处而不是两处，是因为两边一旦用不同的窗口就会给出不同的结论，
 * 而那正是修过的一个 bug：主扫描表显示「存量清算」、警报卡却是空的。
 *
 * 这里仍然算失效线，但只为了**显示**——卡片上那个「失效价」是给你看的
 * 止损参考位，不是判据。
 */
export function buildCard({ row, priceBars, memo, now }: BuildCardInput): BuildCardResult {
  const trigger = pickTrigger(row);
  if (!trigger) return { card: null };

  const isScenario = trigger.type === "scenario";
  const direction: ScenarioDirection = isScenario
    ? trigger.scenario.direction
    : trigger.ignition.direction === "up"
      ? "long"
      : "short";

  const key = isScenario
    ? memoKey(row.symbol, trigger.scenario)
    : ignitionMemoKey(row.symbol, trigger.ignition);

  const firstSeenAt = memo?.firstSeenAt ?? new Date(now).toISOString();
  const firstPrice = memo?.firstPrice ?? row.price;
  const newMemo = memo ? undefined : { key, symbol: row.symbol, firstSeenAt, firstPrice };

  const line = isScenario ? invalidationLine(trigger.scenario) : ignitionLine(trigger.ignition);

  // 刚开的卡在序列里还没有属于它的 K 线，用当前价顶上。
  const ext = extremesSince(priceBars, new Date(firstSeenAt).getTime()) ?? {
    high: row.price,
    low: row.price,
  };

  // 峰值取区间内对这个方向最有利的那一端：做多看最高价，做空看最低价。
  // 再和当前价取 max，是因为 K 线是 30 分钟粒度，最后一根还没走完时
  // 当前价可能已经超出它的区间。
  const best = direction === "short" ? ext.low : ext.high;
  const peakPct = Math.max(
    0,
    signedPct(firstPrice, best, direction),
    signedPct(firstPrice, row.price, direction)
  );

  return {
    card: {
      key,
      symbol: row.symbol,
      coin: row.coin,
      trigger,
      direction,
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
export function sortCards(cards: AlertCardData[]): AlertCardData[] {
  return [...cards].sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));
}
