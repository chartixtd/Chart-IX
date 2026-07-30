/**
 * Time ↔ fractional logical-index conversion for the drawing overlay.
 *
 * Drawings are anchored in (time, price). Turning a time into a pixel needs a
 * logical bar index, and `timeToCoordinate` only answers for times that exist
 * in the data — so a shape dragged past the newest bar, or anchored to a bar
 * scrolled out of the loaded window, would vanish. Interpolating the logical
 * index ourselves keeps the mapping defined everywhere, including beyond both
 * ends of the series, where we extrapolate using the adjacent bar spacing.
 */

/** Fractional logical index for `t`, extrapolating outside the loaded range. */
export function timeToLogical(times: number[], t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  if (t <= times[0]) {
    const step = times[1] - times[0];
    return step > 0 ? -(times[0] - t) / step : 0;
  }
  if (t >= times[n - 1]) {
    const step = times[n - 1] - times[n - 2];
    return step > 0 ? n - 1 + (t - times[n - 1]) / step : n - 1;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return span > 0 ? lo + (t - times[lo]) / span : lo;
}

/** Inverse of {@link timeToLogical}. */
export function logicalToTime(times: number[], logical: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return times[0];
  if (logical <= 0) {
    const step = times[1] - times[0];
    return Math.round(times[0] + logical * step);
  }
  if (logical >= n - 1) {
    const step = times[n - 1] - times[n - 2];
    return Math.round(times[n - 1] + (logical - (n - 1)) * step);
  }
  const lo = Math.floor(logical);
  return Math.round(times[lo] + (logical - lo) * (times[lo + 1] - times[lo]));
}

/**
 * Snap to the nearest bar so shapes line up with candles, as TradingView does.
 * Times outside the loaded range are returned unchanged — there is no bar to
 * snap to, and rounding them inward would drag the shape onto the last candle.
 */
export function snapToBar(times: number[], t: number): number {
  const n = times.length;
  if (n === 0) return t;
  const idx = Math.round(timeToLogical(times, t));
  if (idx < 0 || idx > n - 1) return t;
  return times[idx];
}
