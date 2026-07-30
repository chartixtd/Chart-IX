/**
 * Direction-aware take-profit / stop-loss crossing check, shared by anything
 * that watches a live price against a position's TP/SL (currently the paper
 * trading watcher; real exchange TP/SL is enforced by BingX itself).
 */
export function checkTpSlHit(
  side: "long" | "short",
  price: number,
  takeProfit: number | null,
  stopLoss: number | null
): "tp" | "sl" | null {
  if (!Number.isFinite(price)) return null;

  const slHit =
    stopLoss != null && (side === "long" ? price <= stopLoss : price >= stopLoss);
  // Stop-loss takes priority on a gap that crosses both in one tick — closing
  // at the more conservative (loss-limiting) trigger.
  if (slHit) return "sl";

  const tpHit =
    takeProfit != null && (side === "long" ? price >= takeProfit : price <= takeProfit);
  if (tpHit) return "tp";

  return null;
}
