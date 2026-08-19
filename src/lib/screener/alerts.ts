import type { Direction, FactorBreakdown, ScannerRow } from "./types";
import { ALERT_CLOSE_STREAK } from "./types";
import type { Scenario, ScenarioDirection } from "./factors/scenario";

export interface OpenAlert {
  id: string;
  symbol: string;
  /**
   * 落库的方向，永远是 long/short——这是 screener_alerts 表 `direction`
   * 列的 check 约束（迁移 048），T22 没有改这条约束（迁移 049 只加了
   * scenario 一列）。它来自触发那一刻 ScannerRow.direction（已经在
   * pipeline.ts 里把 manage 场景兜底成分数方向），供下单链接、"同方向"
   * 这类需要一个确定 long/short 的地方使用。
   *
   * 它**不是**算 peakPct/累计涨跌该用哪个符号的依据——那个要看
   * scenario.direction（可能是 manage），见 effectiveDirection。
   */
  direction: Direction;
  triggerPrice: number;
  peakPct: number | null;
  belowCount: number;
  /** 上一轮记录的完整场景判定，用于比较"这一轮是不是同一个场景"。老警报（T22 之前开的）这里是 null。 */
  scenario: Scenario | null;
}

export interface NewAlert {
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  /** 触发当时的总分，仅供复盘参考——触发条件已经不是总分达标，见下方 planAlerts 顶部注释。 */
  triggerScore: number;
  factors: FactorBreakdown;
  /** 触发这条警报的场景。开警报的条件就是"检测到场景"，这里必然非 null。 */
  scenario: Scenario;
}

export interface AlertUpdate {
  id: string;
  lastPrice: number;
  peakPct: number;
  belowCount: number;
  /**
   * 本轮要落库的场景。场景仍在（kind 相同）时是这一轮最新的判定结果；
   * 场景暂时消失（null，尚未到 ALERT_CLOSE_STREAK 轮）时保留上一次的
   * 已知场景，不清空——警报卡不该在抖动的这几轮里突然变成"无场景"样式
   * 又变回来，而且 effectiveDirection 也需要这份数据算 peakPct 的符号。
   */
  scenario: Scenario;
}

export interface AlertPlan {
  opens: NewAlert[];
  updates: AlertUpdate[];
  /** 要关闭的警报 id */
  closes: string[];
}

/**
 * 触发以来的顺方向涨跌幅。
 *
 * direction 取 ScenarioDirection 而不是 Direction：long 涨为正、short
 * 跌为正（取符号，否则警报卡会把赚钱的空单显示成亏钱）——manage **不
 * 翻号**，直接用原始涨跌幅。manage 场景（存量清算）本身不是一个可以
 * 下单跟随的方向，"该不该翻号"这个问题对它没有意义，索性不翻，
 * 让累计栏显示的就是这段时间价格实际涨了/跌了多少（模板里 RNDR 卡
 * 就是这么算的：`if (dir==='short') chg = -chg` 只翻 short 一种）。
 */
export function signedPct(triggerPrice: number, lastPrice: number, direction: ScenarioDirection): number {
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return 0;
  const raw = ((lastPrice - triggerPrice) / triggerPrice) * 100;
  return direction === "short" ? -raw : raw;
}

/**
 * peakPct/累计涨跌该用哪个方向：优先用场景自己的 direction（可能是
 * manage），场景暂时不可用（理论上不该发生——scenario 是开警报的必要
 * 条件，之后要么被同 kind 的新场景刷新，要么保留上一次的已知场景，
 * 见 AlertUpdate.scenario 的注释）时才退回落库的 long/short 方向。
 */
function effectiveDirection(alert: Pick<OpenAlert, "direction" | "scenario">): ScenarioDirection {
  return alert.scenario?.direction ?? alert.direction;
}

/**
 * 纯函数：给定本轮扫描结果与当前未平警报，算出要开/更新/关闭哪些。
 * 不碰 DB —— 调用方负责把这份计划落库，这样状态机本身可以完全离线测试。
 *
 * T22 把触发/关闭的判据从"总分越过 70/65 两条线"换成了"场景有没有变"，
 * 语义换血：
 *
 * 1. **触发 = 检测到场景。** 不再看 total，`row.scenario !== null` 就是
 *    全部条件。ALERT_TRIGGER_SCORE/ALERT_CLOSE_SCORE 两个常量已经删除，
 *    total 仍然算、仍然管表格排序，只是不再是警报的判据。
 *
 * 2. **同一场景 = kind 相同，不重复推。** 只要这一轮的场景种类
 *    （healthy_trend/inventory_flush/…）跟警报开的时候或者上一次刷新时
 *    记的一样，就只更新 last_price/peak_pct，不当成新事件。这里只比较
 *    kind，不比较 side/direction——同一个 kind 理论上不会无缘无故从
 *    高点侧跳到低点侧，真出现这种边界情况也只是方向号跟着
 *    effectiveDirection 的最新值走，不会导致状态机分裂出两条警报。
 *
 * 3. **场景变了立即换，场景消失要等 3 轮。** kind 变成另一个非 null 的
 *    kind → 立刻关旧开新，不设缓冲——这本身就是一个新事件，没有"迟疑"
 *    的必要。kind 变成 null（场景暂时消失）→ 只有连续
 *    ALERT_CLOSE_STREAK(3) 轮都是 null 才真的关闭；摆动点确认本身有
 *    滞后，一两轮的抖动是常态，不该因为抖动就打断一条还在追踪的警报。
 *
 * 4. **缺席 ≠ 失效。** 币这一轮掉出候选池时不做任何处理，警报原样保留
 *    ——这条规则 T22 之前就有，语义没变。
 *
 * 5. **锁定价永不改写。** 只更新 lastPrice / peakPct / belowCount /
 *    scenario，triggerPrice 是这条警报存在的意义，改了整条记录就没用了。
 */
export function planAlerts(rows: ScannerRow[], open: OpenAlert[]): AlertPlan {
  const plan: AlertPlan = { opens: [], updates: [], closes: [] };
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  // 本轮「产生过 update」的 symbol 集合，用来决定第二个循环开不开新警报。
  // 用「本轮是否 update 过」而不是回查 Map，理由与 T22 之前完全一致
  // （见下面第二个循环前的注释）：它对同一 symbol 残留多条未平警报的
  // 中间态天然免疫。
  const updatedSymbols = new Set<string>();

  for (const alert of open) {
    const row = bySymbol.get(alert.symbol);
    if (!row) continue; // 规则 4：缺席保留

    const sameKind = row.scenario !== null && alert.scenario !== null && row.scenario.kind === alert.scenario.kind;

    if (sameKind) {
      // row.scenario 非空（sameKind 已经保证），直接用这一轮最新的方向算符号。
      const dir = row.scenario!.direction;
      plan.updates.push({
        id: alert.id,
        lastPrice: row.price,
        // peakPct 只涨不跌：它记的是「触发以来最好到过哪儿」，不是当前浮盈。
        peakPct: Math.max(alert.peakPct ?? 0, signedPct(alert.triggerPrice, row.price, dir)),
        belowCount: 0, // 场景仍在，抖动计数归零
        scenario: row.scenario!,
      });
      updatedSymbols.add(alert.symbol);
      continue;
    }

    if (row.scenario === null) {
      // 场景暂时消失：容忍窗口内不关，belowCount 记的是「连续多少轮没有场景」。
      const nextBelow = alert.belowCount + 1;
      if (nextBelow >= ALERT_CLOSE_STREAK) {
        plan.closes.push(alert.id);
        continue;
      }
      const dir = effectiveDirection(alert);
      plan.updates.push({
        id: alert.id,
        lastPrice: row.price,
        peakPct: Math.max(alert.peakPct ?? 0, signedPct(alert.triggerPrice, row.price, dir)),
        belowCount: nextBelow,
        // 保留上一次已知场景，不清空——见 AlertUpdate.scenario 的注释。
        // sameKind 分支之外走到这里，alert.scenario 不可能是 null：
        // 开警报的条件就是场景非空，之后要么被 sameKind 刷新，要么在这里
        // 原样保留，从没有一条路径会把它写成 null。
        scenario: alert.scenario!,
      });
      updatedSymbols.add(alert.symbol);
      continue;
    }

    // row.scenario 非空且 kind 与旧场景不同：这是一个新事件，立即关掉旧的。
    // 新场景开不开、给不给这个 symbol 开新警报，交给下面的循环统一判断——
    // 这样即使这个 symbol 同时残留了另一条未平警报，也不会在这里重复开。
    plan.closes.push(alert.id);
  }

  for (const row of rows) {
    if (!row.scenario) continue; // 规则 1：无场景不触发
    // 本轮已经在维护这个 symbol 的某条未平警报（同一场景刷新，或场景
    // 暂时消失但还在容忍窗口内）→ 不是新事件，不重复开。
    if (updatedSymbols.has(row.symbol)) continue;

    plan.opens.push({
      symbol: row.symbol,
      direction: row.direction,
      triggerPrice: row.price,
      triggerScore: row.total,
      factors: row.factors,
      scenario: row.scenario,
    });
  }

  return plan;
}
