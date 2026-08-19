import { createServiceRoleClient } from "@/lib/supabase/middleware";
import type { AlertPlan, NewAlert, OpenAlert } from "./alerts";
import { signedPct } from "./alerts";
import type { EffectiveDirection, FactorBreakdown } from "./types";
import type { Scenario, ScenarioKind, ScenarioDirection } from "./factors/scenario";

/** 前端警报栏需要的一行 */
export interface AlertRecord {
  id: string;
  symbol: string;
  /**
   * 有效方向（评审 F2 修复）：有场景时是 scenario.direction（可能是
   * manage），无场景（老警报）时是分数兜底方向。这一列与 currentPct 的
   * 符号同源——不会再出现"徽章显示 SHORT、涨跌却按 manage 不翻号"这种
   * 自相矛盾的卡片。
   */
  direction: EffectiveDirection;
  triggeredAt: string;
  triggerPrice: number;
  triggerScore: number;
  factors: FactorBreakdown;
  lastPrice: number | null;
  peakPct: number | null;
  /** 触发价 → 实时价的顺方向涨跌幅，服务端算好省得前端各算各的。符号直接取上面的 direction（单一来源，不再需要从 scenario 另算一遍）。 */
  currentPct: number | null;
  /** 完整场景判定。老警报（T22 之前开的）这一列是 null，前端按「无场景警报」渲染旧样式卡片。 */
  scenario: Scenario | null;
}

interface AlertRow {
  id: string;
  symbol: string;
  /** DB 列，迁移 049 已把 check 约束放宽成 'long'/'short'/'manage'（评审 F2）。 */
  direction: EffectiveDirection;
  triggered_at: string;
  trigger_price: number | string;
  trigger_score: number;
  factors: FactorBreakdown;
  last_price: number | string | null;
  peak_pct: number | string | null;
  below_count: number;
  scenario: unknown;
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const SCENARIO_KINDS: ScenarioKind[] = [
  "healthy_trend",
  "inventory_flush",
  "true_top_div",
  "true_bottom_div",
  "false_top_div",
  "false_bottom_div",
];
const SCENARIO_DIRECTIONS: ScenarioDirection[] = ["long", "short", "manage"];

/**
 * jsonb 列读回来是已经反序列化好的对象（或 null），不是字符串——不需要
 * JSON.parse。但它来自数据库，不是这次进程自己写的，做一遍最小的形状
 * 校验（而不是直接 `as Scenario` 断言），防止手工改过库或者字段以后
 * 演化时读到一个半吊子对象却当成完整 Scenario 用，前端拿着 undefined
 * 字段拼 UI 崩掉。校验失败按「无场景」处理——这与老警报该列为 null
 * 时的降级路径完全一致，调用方不需要关心「为什么没有」。
 */
function parseScenario(v: unknown): Scenario | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.kind !== "string" || !SCENARIO_KINDS.includes(s.kind as ScenarioKind)) return null;
  if (typeof s.direction !== "string" || !SCENARIO_DIRECTIONS.includes(s.direction as ScenarioDirection)) return null;
  if (typeof s.trap !== "boolean") return null;
  if (typeof s.swingPrev !== "number" || typeof s.swingNow !== "number") return null;
  if (typeof s.cvdPct !== "number" || typeof s.oiPct !== "number") return null;
  if (s.side !== "high" && s.side !== "low") return null;
  return s as unknown as Scenario;
}

export async function listOpenAlerts(): Promise<OpenAlert[]> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("screener_alerts")
    .select("id, symbol, direction, trigger_price, peak_pct, below_count, scenario")
    .is("closed_at", null);

  if (error) throw new Error(`Failed to load open alerts: ${error.message}`);

  return (data ?? []).map((r) => {
    const row = r as Pick<
      AlertRow,
      "id" | "symbol" | "direction" | "trigger_price" | "peak_pct" | "below_count" | "scenario"
    >;
    return {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      triggerPrice: num(row.trigger_price) ?? 0,
      peakPct: num(row.peak_pct),
      belowCount: row.below_count,
      scenario: parseScenario(row.scenario),
    };
  });
}

/**
 * 落库顺序刻意是「先关、再更新、最后开」。
 *
 * 场景切换（kind 变了）会在同一个计划里同时产生一条 close 和一条 open，
 * 两者是同一个 symbol。先开后关的话，那一瞬间同一个币有两条未平警报，
 * 而下一轮的 listOpenAlerts 会两条都读回来 —— 状态机的 openBySymbol
 * 逻辑靠「本轮是否 update 过」这个集合判断，两条未平记录会让下一轮
 * 的 kind 比较错配到其中一条，顺序颠倒过的坑 T22 之前就踩过一次，
 * 这里原样不动。
 *
 * 返回真正新建成功的那些，供调用方推送。新建失败（比如 DB 抖动）时
 * 绝不能推送——推了却没落库，下一轮会当成「还没触发过」再推一次。
 */
export async function applyAlertPlan(plan: AlertPlan): Promise<NewAlert[]> {
  const client = createServiceRoleClient();

  if (plan.closes.length > 0) {
    const { error } = await client
      .from("screener_alerts")
      .update({ closed_at: new Date().toISOString() })
      .in("id", plan.closes);
    if (error) console.error("[screener] failed to close alerts", error);
  }

  for (const u of plan.updates) {
    const { error } = await client
      .from("screener_alerts")
      .update({
        last_price: u.lastPrice,
        last_price_at: new Date().toISOString(),
        peak_pct: u.peakPct,
        below_count: u.belowCount,
        scenario: u.scenario,
      })
      .eq("id", u.id);
    if (error) console.error("[screener] failed to update alert", u.id, error);
  }

  if (plan.opens.length === 0) return [];

  const { data, error } = await client
    .from("screener_alerts")
    .insert(
      plan.opens.map((o) => ({
        symbol: o.symbol,
        direction: o.direction,
        trigger_price: o.triggerPrice,
        trigger_score: o.triggerScore,
        factors: o.factors,
        last_price: o.triggerPrice,
        last_price_at: new Date().toISOString(),
        peak_pct: 0,
        scenario: o.scenario,
      }))
    )
    .select("symbol");

  if (error) {
    console.error("[screener] failed to open alerts", error);
    return [];
  }

  const inserted = new Set((data ?? []).map((r) => (r as { symbol: string }).symbol));
  return plan.opens.filter((o) => inserted.has(o.symbol));
}

/** 供前端警报栏读取的未平警报，按触发时间倒序。 */
export async function listAlertRecords(): Promise<AlertRecord[]> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("screener_alerts")
    .select(
      "id, symbol, direction, triggered_at, trigger_price, trigger_score, factors, last_price, peak_pct, below_count, scenario"
    )
    .is("closed_at", null)
    .order("triggered_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[screener] failed to list alerts", error);
    return [];
  }

  return (data ?? []).map((r) => {
    const row = r as AlertRow;
    const triggerPrice = num(row.trigger_price) ?? 0;
    const lastPrice = num(row.last_price);
    // direction 列本身就是"有效方向"（评审 F2：单一来源），currentPct 直接
    // 用它算符号，不再需要从 scenario 里另外派生一遍——两者天然同源。
    return {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      triggeredAt: row.triggered_at,
      triggerPrice,
      triggerScore: row.trigger_score,
      factors: row.factors,
      lastPrice,
      peakPct: num(row.peak_pct),
      currentPct: lastPrice === null ? null : signedPct(triggerPrice, lastPrice, row.direction),
      scenario: parseScenario(row.scenario),
    };
  });
}

/** 标记这批警报已推送。失败只记录——推都推了，标记不上不该让整轮扫描失败。 */
export async function markAlertsPushed(symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  try {
    const client = createServiceRoleClient();
    await client
      .from("screener_alerts")
      .update({ pushed_at: new Date().toISOString() })
      .is("closed_at", null)
      .is("pushed_at", null)
      .in("symbol", symbols);
  } catch (err) {
    console.error("[screener] failed to mark alerts pushed", err);
  }
}
