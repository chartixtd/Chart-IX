import type { Direction, FactorBreakdown, ScannerRow } from "./types";
import { ALERT_TRIGGER_SCORE, ALERT_CLOSE_SCORE, ALERT_CLOSE_STREAK } from "./types";

export interface OpenAlert {
  id: string;
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  peakPct: number | null;
  belowCount: number;
}

export interface NewAlert {
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  triggerScore: number;
  factors: FactorBreakdown;
}

export interface AlertUpdate {
  id: string;
  lastPrice: number;
  peakPct: number;
  belowCount: number;
}

export interface AlertPlan {
  opens: NewAlert[];
  updates: AlertUpdate[];
  /** 要关闭的警报 id */
  closes: string[];
}

/**
 * 触发以来的顺方向涨跌幅。做空下跌算正收益 —— 不取符号的话
 * 警报卡会把一笔赚钱的空单显示成亏钱。
 */
export function signedPct(triggerPrice: number, lastPrice: number, direction: Direction): number {
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return 0;
  const raw = ((lastPrice - triggerPrice) / triggerPrice) * 100;
  return direction === "long" ? raw : -raw;
}

/**
 * 纯函数：给定本轮扫描结果与当前未平警报，算出要开/更新/关闭哪些。
 * 不碰 DB —— 调用方负责把这份计划落库，这样状态机本身可以完全离线测试。
 *
 * 三条容易写错的规则：
 *
 * 1. **迟滞。** 触发线 80、关闭线 75，中间这 5 分是缓冲区：分数落在
 *    [75, 80) 时警报既不关闭也不累计 belowCount。没有这段缓冲，一个在
 *    80 线上抖动的币会在几十分钟内反复开关、反复推送 Telegram。
 *
 * 2. **缺席 ≠ 失效。** 币这一轮掉出候选池（成交量萎缩、市值漂移出区间）
 *    时不做任何处理，警报原样保留。按「缺席」关闭会让池子边缘的币
 *    反复误关，而且那一刻我们连它的价格都没有，关闭时刻的记录会是错的。
 *
 * 3. **锁定价永不改写。** 只更新 lastPrice / peakPct / belowCount，
 *    triggerPrice 是这条警报存在的意义，改了整条记录就没用了。
 */
export function planAlerts(rows: ScannerRow[], open: OpenAlert[]): AlertPlan {
  const plan: AlertPlan = { opens: [], updates: [], closes: [] };
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const openBySymbol = new Map(open.map((a) => [a.symbol, a]));

  for (const alert of open) {
    const row = bySymbol.get(alert.symbol);
    if (!row) continue; // 规则 2

    if (row.direction !== alert.direction) {
      plan.closes.push(alert.id);
      continue; // 新方向要不要开警报，交给下面的新开循环统一判断
    }

    const nextBelow = row.total < ALERT_CLOSE_SCORE ? alert.belowCount + 1 : 0;
    if (nextBelow >= ALERT_CLOSE_STREAK) {
      plan.closes.push(alert.id);
      continue;
    }

    plan.updates.push({
      id: alert.id,
      lastPrice: row.price,
      // peakPct 只涨不跌：它记的是「触发以来最好到过哪儿」，不是当前浮盈
      peakPct: Math.max(alert.peakPct ?? 0, signedPct(alert.triggerPrice, row.price, row.direction)),
      belowCount: nextBelow,
    });
  }

  for (const row of rows) {
    if (row.total < ALERT_TRIGGER_SCORE) continue;
    const existing = openBySymbol.get(row.symbol);
    // 同方向已有未平警报 → 这不是「首次突破」，跳过。
    // 反方向的那条已经在上面被关掉了，这里正好开新的。
    if (existing && existing.direction === row.direction) continue;

    plan.opens.push({
      symbol: row.symbol,
      direction: row.direction,
      triggerPrice: row.price,
      triggerScore: row.total,
      factors: row.factors,
    });
  }

  return plan;
}
