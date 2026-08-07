/** Pure helpers for KlineChart's incremental render path. */

export interface PrevBarsMeta {
  earliest: number | null;
  count: number;
}

export type BarsUpdateKind = "full" | "tick" | "append";

/**
 * Decide how the chart should apply a new bars array.
 * "tick": the same tail candle changed (poll refresh) — update() only.
 * "append": exactly one candle closed — update() the last two points.
 * "full": anything else (first load, symbol switch, prepend, trim) — setData().
 */
export function classifyBarsUpdate(prev: PrevBarsMeta, times: number[]): BarsUpdateKind {
  if (!times.length || prev.earliest === null || prev.count === 0) return "full";
  if (times[0] !== prev.earliest) return "full";
  if (times.length === prev.count) return "tick";
  if (times.length === prev.count + 1) return "append";
  return "full";
}

/** Content signature for price lines / markers — skip chart writes when unchanged. */
export function overlaySignature(items: ReadonlyArray<Record<string, unknown>>): string {
  return JSON.stringify(items);
}

export type TailKind = "same" | "advanced" | "regressed";

/**
 * Compare the new tail bar's time against the last poll's tail time.
 *
 * `classifyBarsUpdate`'s count-based "tick"/"append" split breaks under
 * sliding-window pagination: BingX's latest-page query is a fixed-size window,
 * so once older pages are loaded (pinning `earliest`), a closed candle shifts
 * the window without changing the merged/deduped array's length — count-based
 * classification alone would misread a real close as a same-bar tick and let
 * the previous candle's authoritative OHLC never land. Comparing the actual
 * tail timestamp instead is robust to that.
 */
export function classifyTail(prevLastTime: number | null, lastTime: number): TailKind {
  if (prevLastTime === null || lastTime === prevLastTime) return "same";
  return lastTime > prevLastTime ? "advanced" : "regressed";
}
