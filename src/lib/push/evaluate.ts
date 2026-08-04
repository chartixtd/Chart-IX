export interface PendingAlert {
  id: string;
  userId: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
}

/**
 * 触发判定的唯一逻辑。服务端是价格提醒的唯一权威——
 * 客户端不再做同样的判定，否则两套逻辑迟早漂移。
 *
 * 拿不到价格就跳过而不是猜：宁可晚一分钟通知，不可误报。
 */
export function evaluateAlerts(
  alerts: PendingAlert[],
  prices: Record<string, number>
): PendingAlert[] {
  return alerts.filter((alert) => {
    const price = prices[alert.symbol];
    if (typeof price !== "number" || !Number.isFinite(price)) return false;
    return alert.direction === "above"
      ? price >= alert.targetPrice
      : price <= alert.targetPrice;
  });
}
