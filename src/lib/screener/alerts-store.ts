import { createServiceRoleClient } from "@/lib/supabase/middleware";
import type { AlertPlan, NewAlert, OpenAlert } from "./alerts";
import { signedPct } from "./alerts";
import type { Direction, FactorBreakdown } from "./types";

/** 前端警报栏需要的一行 */
export interface AlertRecord {
  id: string;
  symbol: string;
  direction: Direction;
  triggeredAt: string;
  triggerPrice: number;
  triggerScore: number;
  factors: FactorBreakdown;
  lastPrice: number | null;
  peakPct: number | null;
  /** 触发价 → 实时价的顺方向涨跌幅，服务端算好省得前端各算各的 */
  currentPct: number | null;
}

interface AlertRow {
  id: string;
  symbol: string;
  direction: Direction;
  triggered_at: string;
  trigger_price: number | string;
  trigger_score: number;
  factors: FactorBreakdown;
  last_price: number | string | null;
  peak_pct: number | string | null;
  below_count: number;
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function listOpenAlerts(): Promise<OpenAlert[]> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("screener_alerts")
    .select("id, symbol, direction, trigger_price, peak_pct, below_count")
    .is("closed_at", null);

  if (error) throw new Error(`Failed to load open alerts: ${error.message}`);

  return (data ?? []).map((r) => {
    const row = r as Pick<AlertRow, "id" | "symbol" | "direction" | "trigger_price" | "peak_pct" | "below_count">;
    return {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      triggerPrice: num(row.trigger_price) ?? 0,
      peakPct: num(row.peak_pct),
      belowCount: row.below_count,
    };
  });
}

/**
 * 落库顺序刻意是「先关、再更新、最后开」。
 *
 * 方向翻转会在同一个计划里同时产生一条 close 和一条 open，两者是同一个
 * symbol。先开后关的话，那一瞬间同一个币有两条未平警报，而下一轮的
 * listOpenAlerts 会两条都读回来 —— 状态机的 openBySymbol 是个 Map，
 * 后写的会覆盖前一条，另一条从此永远关不掉。
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
    .select("id, symbol, direction, triggered_at, trigger_price, trigger_score, factors, last_price, peak_pct, below_count")
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
