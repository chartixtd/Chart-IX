import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { queryFuturesOrder, queryFuturesFullOrder, getFuturesAllFillOrders } from "@/lib/bingx/futures";
import { queryOrder } from "@/lib/bingx/trade";
import type { OrderStatus } from "@/types";

/**
 * 订单对账。
 *
 * recordOrder 只在下单那一刻写一行 status='pending' 的流水，之后 BingX 那边
 * 成没成、成了多少、收了多少手续费，本地一概不知道。这里按 bingx_order_id
 * 回查交易所，把终局状态与成交明细回写进 orders 表。
 *
 * 用 service-role 写：成交历史是审计流水，前端会话只该读不该改，所以
 * 056 迁移刻意没给 orders 加 UPDATE 策略（见该迁移的注释）。
 */

/** 一次对账最多回查多少单。每单至少一次交易所往返，所以这个数字
 *  直接决定最坏情况的往返次数。 */
const MAX_PER_RUN = 40;

/** 刚对过账的单在这段时间内跳过。页面每次挂载都会调一次对账，
 *  没有这道闸，快速切页就是对交易所的连续重复查询。 */
const RESYNC_COOLDOWN_MS = 20_000;

/** 交易所对合约成交明细的回溯窗口。超出这个范围查不到手续费。 */
const FILL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** 已经终结的状态不再回查。 */
const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "filled", "canceled", "rejected", "expired",
]);

/**
 * BingX 的订单状态到本地枚举。
 *
 * 现货与合约两条链路返回的字面量不完全一致（现货有 FAILED / PENDING，
 * 合约有 NEW / WORKING / TRIGGERED），CANCELED 还有英式双 L 的写法，
 * 所以这里按并集列全，拿不准的一律留在 pending——把一个还活着的单
 * 误判成终结，它就再也不会被回查了，这个方向的错误代价更大。
 */
const STATUS_MAP: Record<string, OrderStatus> = {
  NEW: "pending",
  PENDING: "pending",
  WORKING: "pending",
  TRIGGERED: "pending",
  UNTRIGGERED: "pending",
  PARTIALLY_FILLED: "partially_filled",
  PART_FILLED: "partially_filled",
  FILLED: "filled",
  CANCELED: "canceled",
  CANCELLED: "canceled",
  REJECTED: "rejected",
  FAILED: "rejected",
  EXPIRED: "expired",
};

function toStatus(raw: string | undefined | null): OrderStatus | null {
  if (!raw) return null;
  return STATUS_MAP[raw.toUpperCase()] ?? null;
}

/** BingX 的数值一律是字符串，空串和 "0" 要区分对待：空串是「没有这个值」。 */
function num(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface UnsettledRow {
  id: string;
  market_type: "spot" | "futures";
  symbol: string;
  bingx_order_id: string | null;
  status: OrderStatus;
  created_at: string;
}

/** 回查一单的结果。null 字段表示交易所没给这个值，回写时跳过。 */
interface Reconciled {
  status: OrderStatus;
  executed_qty: number | null;
  executed_price: number | null;
  total_value: number | null;
  fee: number | null;
  fee_asset: string | null;
}

async function reconcileFutures(
  apiKey: string, secret: string, row: UnsettledRow
): Promise<Reconciled | null> {
  const orderId = row.bingx_order_id as string;

  // v2/trade/order 是常规查询；个别历史单它会返回 not found，
  // 这时退到 v1/trade/fullOrder——后者能查到已归档的单。
  let o;
  try {
    o = await queryFuturesOrder(apiKey, secret, row.symbol, orderId);
  } catch {
    o = await queryFuturesFullOrder(apiKey, secret, row.symbol, orderId);
  }
  // 合约这个接口把订单裹在 data.order 里（signedRequest 只剥掉了 data 那层）
  const raw = (o as unknown as { order?: typeof o })?.order ?? o;
  if (!raw) return null;

  const status = toStatus(raw.status);
  if (!status) return null;

  const executedQty = num(raw.executedQty);
  const avgPrice = num(raw.avgPrice);
  const cumQuote = num(raw.cumQuote);
  const totalValue =
    cumQuote ?? (avgPrice !== null && executedQty !== null ? avgPrice * executedQty : null);

  // 手续费不在订单对象里，要另查成交明细；那是按交易对批量查的，
  // 所以留到第二轮统一处理（见 collectFuturesFees）。
  return {
    status,
    executed_qty: executedQty,
    executed_price: avgPrice,
    total_value: totalValue,
    fee: null,
    fee_asset: null,
  };
}

async function reconcileSpot(
  apiKey: string, secret: string, row: UnsettledRow
): Promise<Reconciled | null> {
  // 现货这个接口直接把订单平铺在 data 下，手续费也在里面，不用另查。
  const o = await queryOrder(apiKey, secret, row.symbol, row.bingx_order_id as string);
  if (!o) return null;

  const status = toStatus(o.status);
  if (!status) return null;

  const executedQty = num(o.executedQty);
  const quote = num(o.cummulativeQuoteQty);
  // 现货不回成交均价，用成交额除以成交量倒推。
  const avgPrice =
    quote !== null && executedQty !== null && executedQty > 0 ? quote / executedQty : null;

  const fee = num(o.fee);

  return {
    status,
    executed_qty: executedQty,
    executed_price: avgPrice,
    total_value: quote,
    fee: fee !== null ? Math.abs(fee) : null,
    fee_asset: o.feeAsset || null,
  };
}

/**
 * 合约手续费。
 *
 * allFillOrders 是「某交易对某时间段内的全部成交」，没有按 orderId 过滤的
 * 能力（ccxt 也只对反向合约传 orderId），所以按交易对查一次、再在本地按
 * orderId 归集——这比每单查一次少得多的往返。一单可能有多笔成交，手续费要加总。
 */
async function collectFuturesFees(
  apiKey: string,
  secret: string,
  targets: { symbol: string; orderId: string; since: number }[]
): Promise<Map<string, { fee: number; asset: string | null }>> {
  const out = new Map<string, { fee: number; asset: string | null }>();
  if (!targets.length) return out;

  const now = Date.now();
  const bySymbol = new Map<string, number>();
  for (const t of targets) {
    const prev = bySymbol.get(t.symbol);
    if (prev === undefined || t.since < prev) bySymbol.set(t.symbol, t.since);
  }

  for (const [symbol, since] of bySymbol) {
    try {
      // 往前多留一小时：下单时间与成交时间之间总有延迟，边界卡太紧会漏掉成交。
      const startTs = Math.max(since - 60 * 60_000, now - FILL_LOOKBACK_MS);
      const fills = await getFuturesAllFillOrders(apiKey, secret, { symbol, startTs, endTs: now });
      for (const f of fills) {
        const id = String(f.orderId);
        const commission = num(f.commission) ?? 0;
        const prev = out.get(id);
        out.set(id, {
          fee: (prev?.fee ?? 0) + Math.abs(commission),
          asset: prev?.asset ?? (f.currency || null),
        });
      }
    } catch (e) {
      // 查不到手续费不该让整单对账失败——状态和成交均价才是主数据。
      Sentry.captureException(e, { tags: { scope: "reconcile.futuresFees" } });
    }
  }

  return out;
}

export interface ReconcileResult {
  /** 本次回查了多少单 */
  checked: number;
  /** 其中状态或成交明细确实变了的有多少单 */
  updated: number;
  /** 回查失败的单数；失败不影响其余单 */
  failed: number;
}

/**
 * 把该用户尚未终结的实盘单与 BingX 对一遍账。
 *
 * 绝不抛出：这个函数挂在页面加载路径上，单个订单查失败不该让整页读不出历史。
 */
export async function reconcileOrders(
  userId: string,
  options?: { limit?: number; force?: boolean }
): Promise<ReconcileResult> {
  const supabase = createServiceRoleClient();
  const limit = Math.min(options?.limit ?? MAX_PER_RUN, MAX_PER_RUN);

  let query = supabase
    .from("orders")
    .select("id, market_type, symbol, bingx_order_id, status, created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "partially_filled"])
    .not("bingx_order_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!options?.force) {
    const cutoff = new Date(Date.now() - RESYNC_COOLDOWN_MS).toISOString();
    query = query.or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);
  }

  const { data, error } = await query;
  if (error) {
    Sentry.captureException(error, { tags: { scope: "reconcile.select" } });
    return { checked: 0, updated: 0, failed: 0 };
  }

  const rows = (data as UnsettledRow[]) ?? [];
  if (!rows.length) return { checked: 0, updated: 0, failed: 0 };

  const keys = await getDecryptedApiKeys(userId);
  if (!keys) return { checked: 0, updated: 0, failed: 0 };
  const { apiKey, secret } = keys;

  // 第一轮：逐单查状态。串行——交易所的查询接口有每秒配额，几十单并发
  // 打过去只会换来 429，而这是个后台对账，慢一点没有代价。
  const results: { row: UnsettledRow; result: Reconciled | null }[] = [];
  let failed = 0;
  for (const row of rows) {
    try {
      const result =
        row.market_type === "futures"
          ? await reconcileFutures(apiKey, secret, row)
          : await reconcileSpot(apiKey, secret, row);
      results.push({ row, result });
    } catch (e) {
      failed += 1;
      Sentry.captureException(e, { tags: { scope: "reconcile.query" } });
      results.push({ row, result: null });
    }
  }

  // 第二轮：把有成交的合约单按交易对批量补上手续费。
  const feeTargets = results
    .filter(
      ({ row, result }) =>
        row.market_type === "futures" &&
        !!result &&
        result.executed_qty !== null &&
        result.executed_qty > 0
    )
    .map(({ row }) => ({
      symbol: row.symbol,
      orderId: row.bingx_order_id as string,
      since: new Date(row.created_at).getTime(),
    }));
  const fees = await collectFuturesFees(apiKey, secret, feeTargets);

  let updated = 0;
  const syncedAt = new Date().toISOString();

  for (const { row, result } of results) {
    // 查不到或状态无法识别：仍然盖上时间戳，免得下次刷新又卡在同一单上。
    // 某些单（手工在 App 里删掉的、超出交易所保留窗口的）永远查不到。
    if (!result) {
      await supabase.from("orders").update({ last_synced_at: syncedAt }).eq("id", row.id);
      continue;
    }

    const patch: Record<string, unknown> = { last_synced_at: syncedAt, status: result.status };
    // 只写查到值的字段。交易所偶尔在中间态返回空的成交字段，
    // 直接整体覆盖会把上一轮已经对出来的成交价抹成 null。
    if (result.executed_qty !== null) patch.executed_qty = result.executed_qty;
    if (result.executed_price !== null) patch.executed_price = result.executed_price;
    if (result.total_value !== null) patch.total_value = result.total_value;

    const fee = result.fee ?? fees.get(row.bingx_order_id as string)?.fee ?? null;
    const feeAsset = result.fee_asset ?? fees.get(row.bingx_order_id as string)?.asset ?? null;
    if (fee !== null) patch.fee = fee;
    if (feeAsset !== null) patch.fee_asset = feeAsset;

    const { error: upErr } = await supabase.from("orders").update(patch).eq("id", row.id);
    if (upErr) {
      Sentry.captureException(upErr, { tags: { scope: "reconcile.update" } });
      failed += 1;
      continue;
    }
    if (result.status !== row.status || TERMINAL.has(result.status)) updated += 1;
  }

  return { checked: rows.length, updated, failed };
}
