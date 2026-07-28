import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TradingMarket } from "@/types/trading";

export interface RecordOrderInput {
  userId: string;
  apiKeyId: string | null;
  market: TradingMarket;
  symbol: string;
  /**
   * 必须小写。既有的 /orders 页面与 /dashboard 统计都以 `side === "buy"` 比较，
   * 写大写会让实盘单全部显示为 Sell 并污染胜率计算。
   */
  side: "buy" | "sell";
  orderType: string;
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  leverage?: number | null;
  totalValue?: number | null;
  bingxOrderId?: string | null;
  status: "pending" | "filled" | "partially_filled" | "canceled" | "rejected" | "expired";
  errorMessage?: string | null;
  riskRejected?: boolean;
  riskReason?: string | null;
}

/** 今日已下单数（含被风控拒绝的），用于每日次数限额 */
export async function countOrdersToday(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("user_daily_trade_count")
      .select("count")
      .eq("user_id", userId)
      .eq("trade_date", today)
      .maybeSingle();

    if (error) {
      // 读不到计数时按 0 处理：宁可放行也不要因为读表失败而锁死用户下单。
      // 名义额与杠杆限额仍然生效，风险有界。
      Sentry.captureException(error, { tags: { scope: "countOrdersToday" } });
      return 0;
    }
    return data?.count ?? 0;
  } catch (e) {
    // 同样按 0 处理：客户端本身抛出（网络错误等）不应锁死用户下单。
    Sentry.captureException(e, { tags: { scope: "countOrdersToday" } });
    return 0;
  }
}

/**
 * 记录一笔下单尝试。
 *
 * 绝不抛出：调用方在订单已经发到 BingX 之后才调它，
 * 此时任何异常都不该把一次成功的下单报成失败。落库问题只上报 Sentry。
 */
export async function recordOrder(
  supabase: SupabaseClient,
  input: RecordOrderInput
): Promise<void> {
  try {
    const { error } = await supabase.from("orders").insert({
      user_id: input.userId,
      api_key_id: input.apiKeyId,
      market_type: input.market,
      symbol: input.symbol,
      side: input.side,
      order_type: input.orderType,
      quantity: input.quantity,
      price: input.price ?? null,
      stop_price: input.stopPrice ?? null,
      leverage: input.leverage ?? 1,
      total_value: input.totalValue ?? null,
      bingx_order_id: input.bingxOrderId ?? null,
      status: input.status,
      error_message: input.errorMessage ?? null,
      risk_rejected: input.riskRejected ?? false,
      risk_reason: input.riskReason ?? null,
    });
    if (error) {
      Sentry.captureException(error, { tags: { scope: "recordOrder" } });
      return;
    }
    // 每日计数由 orders 表上的 trg_increment_trade_count 触发器（006_trading_rls.sql，
    // 020_trading_limits.sql 中改为跳过 risk_rejected 行）在插入时原子维护，
    // 这里不能重复计数：应用层读-改-写在并发下单时是有竞态的，而触发器的
    // INSERT ... ON CONFLICT ... DO UPDATE 是原子的，不应被绕过或重复实现。
  } catch (e) {
    Sentry.captureException(e, { tags: { scope: "recordOrder" } });
  }
}
