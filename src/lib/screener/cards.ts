import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Scenario, ScenarioDirection } from "./factors/scenario";
import type { FactorBreakdown, ScannerRow } from "./types";
import { CARD_GRACE_MS, CARD_GRACE_MAX } from "./types";
import type { Ignition } from "./ignition";
import { invalidationLine, ignitionLine, scenarioInvalidated, ignitionInvalidated } from "./invalidation";
import type { InvalidationLine } from "./invalidation";

/**
 * 备忘的钥匙 = 一个「结构事件」的身份。
 *
 * 带上 triggeredAt 是关键：场景锚在触发那根 K 线上，锚点没变就是同一件事。
 * 这样币暂时掉出榜单又回来时，首次价与累计变化能接上而不是重置成 0；
 * 而结构一旦更新（触发点换了根 K 线），钥匙自然不同，重新计时。
 *
 * 用时刻而不是价格：价格来自浮点运算，同一个结构在两轮扫描之间可能因为
 * 序列长度变化而算出末位不同的值，钥匙就白白换了一把。
 */
export function memoKey(symbol: string, s: Scenario): string {
  return `${symbol}|${s.kind}|${s.direction}|${s.triggeredAt}`;
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

/**
 * 一张卡为什么结束了。**只在它结束的那一轮判一次**，之后灰着的每一轮原样带着。
 *
 *   · invalidated —— 价格穿了失效线。场景按 K 线极值判（插针也算），点火按
 *     收盘判，跟活卡那一路各自的口径一致（见 invalidation.ts）。
 *   · structure_changed —— 这个币这一轮扫了、K 线也拿到了，但按同一套判定
 *     已经算不出这张卡了：条件不再全部成立，或者判成了别的场景 / 锚点换了。
 *     **价格没有碰到失效线。** 这是最容易被误读的一种——线上一张 OP 的
 *     b3 卡，价格离失效价还有 1.7%，卡片却打着「已结束」，读的人自然以为
 *     是止损被扫了，其实是反弹把「下行力度 / OI 同增」那几条打掉了。
 *   · not_scanned —— 这个币这一轮根本不在扫描名单里：掉出主表而复核名额
 *     又不够，或者掉出了候选池。信号本身还成不成立，系统不知道。
 *   · no_data —— 扫了，但这个币的 K 线没拿到（上游失败），判不了。
 *
 * 前两种是「市场说了话」，后两种是「系统没看」。分开写，是因为对一个可能
 * 正持着仓的人，这两类的含义完全不同：前者该走了，后者该自己去看一眼。
 */
export type ExpiredReason = "invalidated" | "structure_changed" | "not_scanned" | "no_data";

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
  /**
   * 这张卡的信号**已经结束**，留在这里只是为了让人找得到。
   *
   * 存在的理由是一个真实抱怨：Telegram 推过来的币，点进页面找不到。
   * 推送是某一刻的快照（推的那一批就是当轮 payload.cards 的子集），而页面
   * 是「现在」——中间隔了几十分钟到几小时，卡片早就因为失效/结构变了/
   * 点火过期而不再被算出来。页面上什么都不留，看起来就像推送在乱报。
   *
   * 现在这种卡会**灰着留一段时间**（CARD_GRACE_MS），标成「已结束」。
   * 这跟前端实时穿线只变灰不消失是同一个取舍：消失让人无从判断发生过什么，
   * 而「发生过、已经结束」是一个有用的答案。
   */
  expired: boolean;
  /**
   * 结束原因，只在 expired 为 true 时有意义。缺失 = 这张卡是在这个字段加上
   * 之前就结束的（从旧 payload 接过来的灰卡），前端退回只显示「已结束」，
   * 不去猜。可选字段，所以不必抬 SCANNER_PAYLOAD_VERSION：旧形状读出来是
   * undefined，而 undefined 正是这里的合法取值之一。
   */
  expiredReason?: ExpiredReason;
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
  /**
   * 点火要不要出卡。默认跟生产开关一致（现在是关的，见
   * IGNITION_CARDS_ENABLED）；测试传 true 来验那条逻辑本身。
   *
   * 做成可注入而不是直接读常量，是因为「暂时关掉」不该等于「失去测量与
   * 测试它的能力」——scenario.ts 的 enabledKinds 是同一个道理，那边第一版
   * 写成模块常量，当场挂掉六个既有用例。
   */
  ignitionCards?: boolean;
}

export interface BuildCardResult {
  card: AlertCardData | null;
  /** 需要新建的备忘（这个结构事件第一次被看到）。无则 undefined */
  newMemo?: ScenarioMemo;
}

/**
 * 点火还要不要出卡片。
 *
 * **关掉了，但 `ScannerRow.ignition` 照常计算、主扫描表那一列照常显示。**
 * 这个拆分是刻意的：
 *   · 表格里的「▲ 2.3%」是一句事实——这个币刚收盘突破了前 6 小时的区间。
 *     事实不预测什么，留着是有用的上下文。
 *   · 卡片是一句行动建议——「这里值得看/值得做」。而点火恰恰在这一点上
 *     被实测否掉了，见下面。
 *
 * 关掉的依据（189 币 × 90 天）：
 *   · **捕获率只有 36–47%**（三种选币口径下都垫底，基准 65%）。点火在最吵
 *     的币上触发时，那个币前 6 小时**已经涨了 9.23%**——你是在一段行情的
 *     尾巴上进场，之后延续 5.23% / 回吐 4.99%，几乎对称。
 *   · 固定止损止盈网格 20 格**全负，而且是全场最差**（−0.18% ~ −0.59%）。
 *     止损 1% 时胜率只有 31%，基准 43%——突破币插针最凶。
 *   · 这跟它的 MFE 命中率最高（≥5% 达成率 51%，基准 30%）并不矛盾：
 *     **命中率只看「之后还会不会动」，看不到「你已经错过了多少」。**
 *     这是这一路测下来对「MFE 命中率」这个指标最有力的一次证伪。
 *   · types.ts 里 QUIET_RANK_TAKE 那段旧实测（「最吵那档捕获率 33%」）
 *     和我们的新数据在这一点上是一致的。
 *
 * 想连表格那一列一起去掉，就把 pipeline.ts 里的 detectIgnition 调用也摘了；
 * 想恢复出卡，把这里改回 true。
 */
export const IGNITION_CARDS_ENABLED = false;

/**
 * 决定这一行由什么触发卡片。**场景优先于点火。**
 *
 * 两者同时成立时只出一张卡：场景把「资金流与持仓在这段行情里做了什么」
 * 也说清楚了，是严格更多的信息，而点火只说「突破了」。同一个币出两张卡
 * 只会让人以为是两个独立信号。
 */
function pickTrigger(row: ScannerRow, ignitionCards: boolean): CardTrigger | null {
  if (row.scenario) return { type: "scenario", scenario: row.scenario };
  if (ignitionCards && row.ignition) return { type: "ignition", ignition: row.ignition };
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
export function buildCard({
  row,
  priceBars,
  memo,
  now,
  ignitionCards = IGNITION_CARDS_ENABLED,
}: BuildCardInput): BuildCardResult {
  const trigger = pickTrigger(row, ignitionCards);
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
      expired: false,
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

/**
 * 这张卡的触发源有没有被价格证伪。按触发源分派到各自的口径：
 * 场景看 K 线极值（止损被扫了就是被扫了），点火看收盘（影线穿回来不算）。
 */
export function triggerInvalidated(trigger: CardTrigger, bars: CoinGlassPriceBar[]): boolean {
  return trigger.type === "scenario"
    ? scenarioInvalidated(trigger.scenario, bars)
    : ignitionInvalidated(trigger.ignition, bars);
}

/**
 * 判一张刚结束的卡的结束原因。
 *
 * `scannedBars` 是本轮**实际扫过**的每个币 → 它的价格 K 线。没扫的币不在
 * 里面，扫了但没拿到 K 线的是空数组——两者要分开（一个是「没看」，一个是
 * 「看了但看不见」），所以传 Map 而不是只传一个 symbol 集合。
 *
 * 顺序有讲究：先查穿线，再归为「条件已变」。一张穿了线的卡在分类器里同样
 * 是算不出来的（b3 一创新高就被第一道门否掉），只看「算不算得出」分不开
 * 这两种；而穿线是更具体、对持仓者更要紧的那个答案。
 */
export function resolveExpiredReason(
  card: AlertCardData,
  scannedBars: ReadonlyMap<string, CoinGlassPriceBar[]>
): ExpiredReason {
  const bars = scannedBars.get(card.symbol);
  if (bars === undefined) return "not_scanned";
  if (bars.length === 0) return "no_data";
  if (triggerInvalidated(card.trigger, bars)) return "invalidated";
  return "structure_changed";
}

/**
 * 挑出「信号已经结束、但还值得灰着留一会儿」的卡片。
 *
 * 灰卡存在的唯一理由是**让推送里的币找得到**：推送推的就是当轮 cards 的
 * 子集，推的那一刻它一定在页面上；人隔几十分钟才点开，那时卡片早已不再被
 * 算出来，页面什么都不留就像推送在乱报。
 *
 * 三条筛选缺一不可，每一条都是线上问题逼出来的：
 *
 * ① **这个币没有活卡。** 一张灰一张亮并排放着，等于在同一个币上给出两个
 *    互相矛盾的结论，而灰的那张多半只是被新卡换掉的旧身份。
 *
 * ② **这张卡推送过。** 初版没有这条，线上 21 张里 12 张是灰的，绝大多数
 *    根本不是「信号结束」而是**卡片换了身份**：场景抢占点火（场景优先，
 *    点火就不再产出，可那张点火卡明明还成立、价格离失效线还有 1%）、
 *    场景在 kind 之间切换、锚点漂移导致钥匙变化。用户看到的就是
 *    「价格还没到失效价，卡片却显示已结束」。没推过的卡本来就不需要找回。
 *
 * ③ **没超过宽限期。**
 *
 * 传空的 pushedKeys 会让结果为空——那等于回到「卡片直接消失」，也就是加
 * 宽限期之前的行为，是安全的退化方向。
 *
 * `reasonFor` 只对**这一轮刚结束**的卡调用（上一轮还是活的、这一轮没了）。
 * 上一轮已经是灰卡的，原样带着它的原因不再重判——这一轮再判会判错：它当初
 * 是「条件已变」，这一轮币掉出了名单，重判就成了「本轮未扫」。上一轮就是
 * 灰卡却没有原因的（字段加上之前结束的旧卡），保持没有，前端退回「已结束」。
 */
export function carryForwardExpired(
  previous: AlertCardData[],
  liveCards: AlertCardData[],
  pushedKeys: Set<string>,
  now: number,
  reasonFor: (card: AlertCardData) => ExpiredReason
): AlertCardData[] {
  const liveKeys = new Set(liveCards.map((c) => c.key));
  const liveSymbols = new Set(liveCards.map((c) => c.symbol));
  return previous
    .filter((c) => !liveKeys.has(c.key))
    .filter((c) => !liveSymbols.has(c.symbol))
    .filter((c) => pushedKeys.has(c.key))
    .filter((c) => now - new Date(c.firstSeenAt).getTime() < CARD_GRACE_MS)
    .slice(0, CARD_GRACE_MAX)
    .map((c) => ({
      ...c,
      expired: true,
      expiredReason: c.expired ? c.expiredReason : reasonFor(c),
    }));
}
