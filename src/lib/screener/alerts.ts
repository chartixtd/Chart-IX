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
  // 本轮「产生过 update」的 symbol 集合，用来决定第二个循环开不开新警报。
  //
  // 不用 Map(symbol -> 警报) 去回查，是因为一个 symbol 理论上应该至多一条
  // 未平警报，但这个前提在这里既不校验也不强制——一旦落库层出现中间态
  // （比如方向翻转时「先开后关」失败，留下同一个币两条方向相反的未平
  // 警报），Map 会静默丢弃其中一条，回查到的可能正好是刚被本函数关掉的
  // 那条反方向警报，于是又给已经在 update 的同方向警报重复开一条新的。
  // 用「本轮是否 update 过」是严格更安全的等价判断：有 update 就说明存在
  // 一条同方向、且本轮没被关掉的未平警报；如果它是因为 belowCount 满 3
  // 被关掉的，那么 total < 75 < 80，第二个循环本来也进不去。它对同一
  // symbol 有多条未平警报天然免疫。
  const updatedSymbols = new Set<string>();

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
    updatedSymbols.add(alert.symbol);
  }

  for (const row of rows) {
    if (row.total < ALERT_TRIGGER_SCORE) continue;
    // 同方向已有未平警报（本轮已经 update 过）→ 这不是「首次突破」，跳过。
    // 反方向的那条已经在上面被关掉了，这里正好开新的。
    if (updatedSymbols.has(row.symbol)) continue;

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
