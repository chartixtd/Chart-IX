import type { Scenario } from "./factors/scenario";

/**
 * 场景的「失效价」——价格走到这里，就等于市场证明这个信号错了。
 *
 * 为什么需要它：场景锚在**已确认的**摆动点上，而摆动点要等 PIVOT_N(5) 根
 * 30 分钟 K 线走完才算确认。所以在结构真的翻掉之后，还要过最多 2.5 小时
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

/** 真背离两格：论点是「这个极值是虚的」，所以极值本身就是失效线。 */
function betsOnExtreme(kind: Scenario["kind"]): boolean {
  return kind === "true_top_div" || kind === "true_bottom_div";
}

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
 * 算出一个场景的失效线。
 *
 * 返回 null 的唯一情形是锚点价格非法（非有限值或非正数）——那种数据本身
 * 就不可信，宁可这张卡没有失效线，也不要给出一个错误的止损位。
 */
export function invalidationLine(scenario: Scenario): InvalidationLine | null {
  const anchor = betsOnExtreme(scenario.kind) ? scenario.swingNow : scenario.swingPrev;
  if (!Number.isFinite(anchor) || anchor <= 0) return null;

  // 高点侧：极值在上方（穿上去才算突破极值），前一个摆动点在下方（跌回去才算突破失败）。
  // 低点侧完全镜像。两者合起来就是下面这个异或关系。
  const breach: "above" | "below" =
    scenario.side === "high"
      ? betsOnExtreme(scenario.kind)
        ? "above"
        : "below"
      : betsOnExtreme(scenario.kind)
        ? "below"
        : "above";

  return { price: anchor, breach };
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
  // 严格不等：恰好碰到失效价不算穿。摆动点价格本身就是那一根 K 线的
  // 最高/最低价，所以「碰到」在锚点那一刻必然成立——用 >= 会让每张卡
  // 在诞生的同一秒就判定失效。
  return line.breach === "above" ? high > line.price : low < line.price;
}
