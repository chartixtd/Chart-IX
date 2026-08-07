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
  } catch (e) {
    Sentry.captureException(e, { tags: { scope: "recordOrder" } });
  }
}
