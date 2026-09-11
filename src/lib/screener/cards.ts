import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Scenario, ScenarioDirection } from "./factors/scenario";
import type { FactorBreakdown, ScannerRow } from "./types";
import { CARD_GRACE_MS, CARD_GRACE_MAX, CARD_MAX_AGE_MS } from "./types";
import type { Ignition } from "./ignition";
import { invalidationLine, ignitionLine, scenarioInvalidated, ignitionInvalidated, isInvalidated } from "./invalidation";
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
 * 卡片只有两种状态：**活着**，或者**已失效**。
 *
 * 失效只有两个条件，谁先到算谁：
 *   ① 价格碰到了这张卡自己的失效线（市场证伪了它）；
 *   ② 卡片出现满 6 小时（CARD_MAX_AGE_MS，它过气了）。
 *
 * 除这两条之外没有任何东西能让一张卡结束——场景条件不再成立、判成了别的
 * 场景、锚点漂了、这个币掉出扫描名单、K 线拿不到，全都**不算**，卡片照常
 * 活着。
 *
 * 这是一次刻意的语义收窄。此前卡片是「当轮扫描的视图」：算得出来就在，
 * 算不出来就没。后果是绝大多数卡片的消失跟价格无关，而页面上又画着一条
 * 很显眼的失效线，读的人只能理解成「碰线了」。线上那张 OP 的卡是典型：
 * 失效价 0.1135 是本波高点，之后没有一根 K 线的最高价超过它，价格离线还有
 * 1.7%，卡却结束了——真实原因是反弹把「下行力度 / OI 同增」那几条打掉了。
 *
 * 现在换成：**卡片有自己的生命周期，起点是信号出现，终点是它被证伪或者
 * 过气。** 一张卡在这两点之间一直挂着，即使系统这一轮判不出这个场景了。
 *
 * 代价是明确的，写在这里免得日后当成 bug：主扫描表的场景列仍然每轮重算
 * （它回答的是「这个币现在是什么局面」），所以会出现**表格那一行没有场景、
 * 而这个币的卡片还活着**的情况。两者回答的不是同一个问题——表格说的是
 * 现在，卡片说的是「那个还没被证伪的信号」。
 */

/** 一张卡死于哪一条：价格碰到失效线，还是活满了 6 小时。 */
export type DeadReason = "invalidation" | "timeout";

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
   * 这张卡已经结束了：价格碰到了失效线，或者它活满了 6 小时。
   *
   * 失效之后卡片不立刻消失，而是**灰着留一段时间**（CARD_GRACE_MS），
   * 让人看得到它是怎么死的：消失让人无从判断发生过什么，而「它到过失效价」
   * 或「它过气了」都是有用的答案。这跟前端实时穿线只变灰不消失是同一个取舍。
   */
  expired: boolean;
  /**
   * 死于两个条件里的哪一个。只在 expired 为 true 时有意义。
   *
   * 标签上两者都叫「已失效」——对读的人来说结论是同一个：别再按它操作。
   * 但底下那句解释必须分开，「价格已穿过失效价 X」按在一张超时卡上就是
   * 一句假话，而那张卡的价格可能离失效线还很远。
   *
   * 缺失 = 这个字段加上之前失效的旧灰卡，前端退回按碰线解释。旧灰卡最多
   * 活过一轮部署，代价有限。
   */
  expiredBy?: DeadReason;
  /**
   * 失效发生的时刻。宽限期从**这里**算起，不是从 firstSeenAt 算起。
   *
   * 早先的宽限期是拿 firstSeenAt 量的，那在卡片只活一两轮的年代还看得过去；
   * 现在一张卡可以活很久，再用出生时间量，一张活了三天才碰线的卡会在失效的
   * 同一秒就超期消失——恰恰是最该被看见的那一刻。
   */
  expiredAt?: string;
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

  // 这个结构事件的卡已经活完 6 小时了——**不再出新卡**。
  //
  // 修的是一个会自我复制的 bug。备忘的 TTL 是 8 天，而卡片只活 6 小时
  // （CARD_MAX_AGE_MS），中间那段空档里，只要这个结构还判得出来，每一轮都会
  // 拿着同一条备忘再造一张卡；而备忘里的 firstSeenAt 是 6 小时前，所以新卡
  // **一出生就已经超时**，下一轮立刻又变成一张灰卡——firstSeenAt 与 expiredAt
  // 跟上一张一模一样。线上实测每 15 分钟多一张，ASTER 一个币堆了 5 张完全
  // 相同的灰卡。
  //
  // 判据用备忘而不是「有没有灰卡」：灰卡只留 2 小时（CARD_GRACE_MS），过了
  // 宽限期它就不在 payload 里了，而备忘还在——那正是复制会一直继续下去的
  // 原因。备忘的存在期覆盖得住这个空档。
  //
  // 结构本身真的翻新了怎么办？那它的 triggeredAt 会变，memoKey 跟着变，这里
  // 查到的是一条全新的备忘（memo 为 undefined），照常出卡。
  if (memo && now - new Date(memo.firstSeenAt).getTime() >= CARD_MAX_AGE_MS) {
    return { card: null };
  }

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
 * 卡片排序：**最新出现的在最上面。**
 *
 * 这里来回改过一次，记下来免得再翻烙饼。曾经按分数排，理由是「打开警报栏
 * 想问的是现在最值得看的是哪个」。但那个理由建立在卡片只活一两轮的旧模型
 * 上——那时榜上的卡片新鲜度都差不多，按分数排才是在同一批里挑最强的。
 *
 * 现在一张卡最多活 6 小时（CARD_MAX_AGE_MS），榜上同时挂着刚出的和快过气的，
 * 而这类信号的价值随时间衰减得很快：一个 5 小时前的高分信号，不如一个刚
 * 出来的中分信号有用，因为前者的行情多半已经走完了。时间在这里比分数更
 * 接近「值不值得现在看」。
 *
 * 同一刻出现的按 symbol，保证顺序稳定可复现。
 */
export function sortCards(cards: AlertCardData[]): AlertCardData[] {
  return [...cards].sort(
    (a, b) =>
      new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime() ||
      a.symbol.localeCompare(b.symbol)
  );
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
 * 用本轮扫到的新数据刷新一张**还活着**的卡。
 *
 * 只动会变的那几样：分数、两个因子、峰值、以及「现在多少钱」所依赖的价格。
 * 身份那几样一律不动——key、trigger、firstSeenAt、firstPrice、invalidation
 * 都锚在信号出现的那一刻，改了就等于把这张卡换成了另一张。失效线尤其不能
 * 跟着重算：一条会移动的失效线没法当判据，也没法让人照着操作。
 */
export function refreshCard(
  card: AlertCardData,
  row: ScannerRow,
  priceBars: CoinGlassPriceBar[]
): AlertCardData {
  const ext = extremesSince(priceBars, new Date(card.firstSeenAt).getTime()) ?? {
    high: row.price,
    low: row.price,
  };
  const best = card.direction === "short" ? ext.low : ext.high;
  // 跟 buildCard 同一个算法，而且**只增不减**：峰值是「最好到过哪儿」，
  // 一段回撤不该把它抹掉。
  const peakPct = Math.max(
    card.peakPct,
    0,
    signedPct(card.firstPrice, best, card.direction),
    signedPct(card.firstPrice, row.price, card.direction)
  );
  return { ...card, factors: row.factors, total: row.total, peakPct };
}

/**
 * 这张卡**此刻**该不该当成已失效，以及死于哪一条。活着返回 null。
 *
 * 三个来源，服务端那个最权威（它带着精确的失效时刻），另外两个是前端抢在
 * 服务端确认之前就把结论说出来——扫描 15 分钟一轮，而「别再按它操作」这件事
 * 应该在一秒内知道。
 *
 * **这个判断必须是共享的。** 它曾经只长在 AlertCard 里，于是一张前端判定
 * 失效的卡在服务端眼里还是活卡，排序照活卡排——线上的样子是一张灰着的
 * BOME 夹在两张亮卡中间，而它后面还跟着别的活卡。判定和排序读同一个函数，
 * 那种错位才不会再出现。
 *
 * 碰线优先于超时：一张既穿了线又到点的卡，碰线是更具体、对持仓的人更要紧的
 * 那个答案。兜底的 "invalidation" 接的是服务端说它死了、却没说怎么死的旧卡。
 */
export function cardDeadReason(
  card: AlertCardData,
  livePrice: number | null,
  now: number
): DeadReason | null {
  const crossed =
    card.invalidation !== null &&
    livePrice !== null &&
    isInvalidated(card.invalidation, livePrice, livePrice);
  const agedOut = now - new Date(card.firstSeenAt).getTime() >= CARD_MAX_AGE_MS;

  if (card.expired) return card.expiredBy ?? (agedOut && !crossed ? "timeout" : "invalidation");
  if (crossed) return "invalidation";
  if (agedOut) return "timeout";
  return null;
}

/**
 * 最终摆上警报栏的那一份名单。**一个币只占一张卡。**
 *
 * 这条规则曾经写在旧的 carryForwardExpired 里，重写成 advanceCards 时弄丢了，
 * 线上立刻复现：BOME 的做空卡碰线失效变灰，同一轮又判出一个做多场景出了新卡，
 * 于是同一个币并排挂着一张灰的「派发力度到位，做空」和一张亮的「吸筹力度
 * 到位，做多」。两张卡对同一个币给出方向相反的结论，而它们其实是同一段行情
 * 的前后两截。
 *
 * 取舍是「活的压过灰的」：灰卡的用处是让推送过来的人找得到这个币，而这个币
 * 要是已经有了新的活卡，人点进来照样找得到它，还能顺带看到现在该怎么看。
 *
 * 同一个币有多张活卡时留**最新**的那张，跟 sortCards 一个方向：卡片的价值
 * 随时间衰减得快，同一个币上更晚出现的那张说的是更近的事。
 */
export function pickVisibleCards(
  live: AlertCardData[],
  expired: AlertCardData[],
  maxLive: number
): AlertCardData[] {
  // 「有活卡的币」要在截断**之前**收齐。用截断之后的名单去挡灰卡，会让一个
  // 撞上 CARD_MAX_LIVE 被砍掉活卡的币转而显示它的灰卡——等于把一张有用的卡
  // 换成一张没用的，还照样占一格。
  const hasLive = new Set(live.map((c) => c.symbol));

  const shown = new Set<string>();
  const keptLive: AlertCardData[] = [];
  for (const c of sortCards(live)) {
    if (shown.has(c.symbol)) continue;
    shown.add(c.symbol);
    keptLive.push(c);
    if (keptLive.length >= maxLive) break;
  }

  // 灰卡沿用 advanceCards 排好的顺序（失效时刻倒序），这里只做减法：
  // 有活卡的币不留，同一个币也只留最近死的那一张。
  const greySeen = new Set<string>();
  const keptExpired: AlertCardData[] = [];
  for (const c of expired) {
    if (hasLive.has(c.symbol) || greySeen.has(c.symbol)) continue;
    greySeen.add(c.symbol);
    keptExpired.push(c);
  }

  return [...keptLive, ...keptExpired];
}

export interface AdvanceCardsInput {
  /** 上一轮 payload 里的全部卡片，活的和灰的都在。 */
  previous: AlertCardData[];
  /**
   * 本轮能用来**复核碰线**的价格 K 线，按 symbol。
   *
   * 不在这张表里的币，这一轮无法判定它有没有碰线——那时卡片**继续活着**，
   * 而不是被当成结束。这是「只有碰线才算失效」的直接推论：判不了不等于死了。
   * 漏判的那部分由前端兜底（实时成交价每帧都在跟失效线比，见 AlertCard）。
   */
  bars: ReadonlyMap<string, CoinGlassPriceBar[]>;
  /** 本轮扫描出的行，按 symbol。有就用来刷新活卡的分数与峰值，没有就保持原样。 */
  rows: ReadonlyMap<string, ScannerRow>;
  now: number;
}

export interface AdvanceCardsResult {
  /** 仍然活着的卡（含这一轮判不了的）。 */
  live: AlertCardData[];
  /** 已失效、还在宽限期里的灰卡。 */
  expired: AlertCardData[];
}

/**
 * 把上一轮的卡片推进到这一轮。**这是卡片去留的唯一裁决处。**
 *
 * 四条路，仅此四条：
 *   ① 已经是灰卡 → 宽限期没过就留着，过了就丢。灰卡不会复活。
 *   ② 活卡，出现满 6 小时 → 超时失效。**这一条排在最前面，因为它不需要
 *      K 线**：一个这轮没被复核的币照样会超时，否则「拿不到数据的卡继续
 *      活着」会变成一条永远不过期的后门。
 *   ③ 活卡，这轮能复核 → 碰线了就失效（记下时刻），没碰就刷新数据继续活。
 *   ④ 活卡，这轮复核不了 → 原样继续活着，等下一轮或者等它超时。
 *
 * 注意这里**没有**「场景还在不在」这一问。判定只问价格和时间，不问结构。
 */
export function advanceCards({ previous, bars, rows, now }: AdvanceCardsInput): AdvanceCardsResult {
  const live: AlertCardData[] = [];
  const expired: AlertCardData[] = [];

  // 同一个 key 只推进一次。上一轮的 payload 理论上不该有重复，但这里是所有
  // 卡片的必经之路，去重放在这儿，任何一条产生重复的路径都会在下一轮被自愈
  // ——而不是把重复原样传下去，一轮轮地攒着。
  const seen = new Set<string>();

  for (const card of previous) {
    if (seen.has(card.key)) continue;
    seen.add(card.key);

    if (card.expired) {
      // 没有 expiredAt 的是这个字段加上之前失效的旧卡。用 firstSeenAt 顶上
      // 只会把它们立刻判超期，那是安全的方向——旧灰卡本来就活不过一轮部署。
      const since = new Date(card.expiredAt ?? card.firstSeenAt).getTime();
      if (now - since < CARD_GRACE_MS) expired.push(card);
      continue;
    }

    // 超时那一刻记的是**它真正到期的时刻**（出现时间 + 6 小时），不是我们
    // 发现它的时刻。扫描 15 分钟一轮，用 now 会让每张超时卡的宽限期平白
    // 多出最多一刻钟，而「它什么时候过的期」是个确定的事实，没必要糊掉。
    const deadline = new Date(card.firstSeenAt).getTime() + CARD_MAX_AGE_MS;
    if (now >= deadline) {
      expired.push({
        ...card,
        expired: true,
        expiredAt: new Date(deadline).toISOString(),
        expiredBy: "timeout",
      });
      continue;
    }

    const b = bars.get(card.symbol);
    if (b === undefined || b.length === 0) {
      live.push(card);
      continue;
    }

    if (triggerInvalidated(card.trigger, b)) {
      expired.push({
        ...card,
        expired: true,
        expiredAt: new Date(now).toISOString(),
        expiredBy: "invalidation",
      });
      continue;
    }

    const row = rows.get(card.symbol);
    live.push(row ? refreshCard(card, row, b) : card);
  }

  // 灰卡按失效时刻倒序取前 N 张：行情剧烈时一批卡同时失效，全留会把警报栏
  // 淹掉，而最该被看见的是**刚刚**死掉的那几张。
  expired.sort(
    (a, b2) =>
      new Date(b2.expiredAt ?? b2.firstSeenAt).getTime() -
      new Date(a.expiredAt ?? a.firstSeenAt).getTime()
  );

  return { live, expired: expired.slice(0, CARD_GRACE_MAX) };
}
