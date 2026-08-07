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
