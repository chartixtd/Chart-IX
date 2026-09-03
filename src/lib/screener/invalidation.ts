import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Scenario } from "./factors/scenario";
import type { Ignition } from "./ignition";

/**
 * 场景的「失效价」——价格走到这里，就等于市场证明这个信号错了。
 *
 * 为什么需要它：场景锚在**已确认的**摆动点上，而摆动点要等 PIVOT_N(2) 根
 * 30 分钟 K 线走完才算确认。所以在结构真的翻掉之后，还要过最多 1 小时
 * 新场景才会被判出来。这段空窗期里，一张「真底背离·反手做多」的卡会在
 * 价格已经跌穿那个底之后，继续挂在那儿喊进场——价格早就说明它错了，
 * 而系统还不知道。
 *
 * 失效线把这段空窗补上：它不需要等任何确认，价格碰到就是碰到了。
 *
 * **每种场景的失效位置，是它自己的论点决定的，不是我们外加的止损建议：**
 *
 *   · 真顶背离（做空）：论点是「这个新高是虚的」。价格再创新高 → 顶不是顶。
 *   · 真底背离（做多）：论点是「这个新低是虚的」。价格再创新低 → 底不是底。
 *   · 其余四种（健康趋势 / 存量清算 / 假顶背离 / 假底背离）：论点都建立在
 *     「已经突破了前一个摆动点」这个事实上。价格收回到前一个摆动点之外 →
 *     那次突破是假的，四种论点一起死。
 *
 * 归纳成一句：**真背离赌的是极值本身，失效线在 `swingNow`；其余四种赌的是
 * 突破成立，失效线在 `swingPrev`。**
 */

export interface InvalidationLine {
  /** 失效价 */
  price: number;
  /**
   * 往哪个方向穿算失效。
   * "above" = 价格涨过 price 算失效；"below" = 跌破 price 算失效。
   */
  breach: "above" | "below";
}

/**
 * 场景的失效线。
 *
 * 新引擎里每个场景**自己带**失效位（Scenario.invalidation），因为规格要求
 * 每个场景都有明确的失效位、没有就不成立——A2/B2 是 sweep 那一根的极值，
 * A3/B3 是本波最低/最高点，A1/B1 是那个不能破的 swing，A4/B4 是清算极值。
 *
 * 这里曾经是一张「哪种场景赌什么、失效线放哪」的推导表。那张表随判定逻辑
 * 一起搬进了 scenario.ts：失效位是判定的一部分（没有失效位就不该判出场景），
 * 拆在两个文件里迟早会对不上。
 */
export function invalidationLine(scenario: Scenario): InvalidationLine | null {
  const { price, breach } = scenario.invalidation;
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, breach };
}

/**
 * 价格有没有打穿失效线。
 *
 * `high` / `low` 传区间内的最高价与最低价（而不是某个采样价）：插针也算数。
 * 止损被扫了就是被扫了，用收盘价或轮询到的现价去判会漏掉真实发生过的穿越，
 * 而那种漏判恰恰发生在行情最剧烈、这张卡最需要被撤下的时候。
 *
 * 实时那一路（WebSocket 逐笔价）把同一个价格同时当 high 和 low 传进来即可。
 */
export function isInvalidated(line: InvalidationLine, high: number, low: number): boolean {
  if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
  // 严格不等：恰好碰到失效价不算穿。结构位本身就取自某一根 K 线的极值，
  // 所以「碰到」在锚点那一刻必然成立——用 >= 会让每张卡在诞生的同一秒
  // 就判定失效。
  return line.breach === "above" ? high > line.price : low < line.price;
}

/**
 * 这个场景是不是已经被价格证伪了。
 *
 * 窗口从**触发那一刻**（`triggeredAt`）算起，而不是从「我们第一次看到这张
 * 卡」算起。后者取决于扫描什么时候轮到这个币，跟结构本身无关；而且它会漏判
 * 最要紧的一类：结构成形之后、我们看到之前，价格已经走反了。
 *
 * 实测过一次真实漏判：某个币的场景锚在两个很早的低点上，失效线远在现价
 * 下方，价格早就反弹上去了；按「第一次看到」算的窗口里一次穿越都没有，
 * 因为穿越发生在我们看到它之前。按结构成形算就一目了然。
 */
export function scenarioInvalidated(scenario: Scenario, bars: CoinGlassPriceBar[]): boolean {
  const line = invalidationLine(scenario);
  if (!line) return false;

  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.time < scenario.triggeredAt) continue;
    const h = parseFloat(b.high);
    const l = parseFloat(b.low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  // 一根都没有 = 触发点比整段序列还新，理论上不可能（它就取自这段序列）。
  // 真出现了就当没失效——宁可留着一个可疑的场景，也不要因为一个说不通的
  // 数据状态把所有场景静默清空。
  if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
  return isInvalidated(line, high, low);
}

/**
 * 点火的失效线：**被突破的那条区间边界**。
 *
 * 不需要像六场景那样分情况讨论——点火的论点只有一句「站上/跌破了前 6 小时
 * 的区间」，价格走回来够深，这句话就不成立了。
 *
 * 「够深」不是区间边界本身。实测 773 个事件，线画在边界上 84% 会被打穿，
 * 而且中位情况下你在行情走出任何东西之前就已经作废——见
 * ignition.ts 的 IGNITION_STOP_ATR_MULT。所以用的是 invalidationPrice
 * （边界往外让 1×ATR），不是 level。
 *
 * 判据用**收盘价 / 现价**，不用区间极值——这跟六场景刻意相反。六场景的
 * 失效是「止损被扫了就是被扫了」，插针也算数；点火的失效是「这次突破没
 * 站住」，而影线穿回来一下又拉上去，恰恰是突破成立时的常见走法，用极值
 * 判会把大多数真突破当场判死。detectIgnition 内部的存活判定用的也是收盘价，
 * 两边同一个口径。
 */
export function ignitionLine(ignition: Ignition): InvalidationLine | null {
  if (!Number.isFinite(ignition.invalidationPrice) || ignition.invalidationPrice <= 0) return null;
  return {
    price: ignition.invalidationPrice,
    breach: ignition.direction === "up" ? "below" : "above",
  };
}
