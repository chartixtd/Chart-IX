/** Simple moving average over `period` closes. Returns one point per input index
 * once enough history has accumulated (earlier indices are skipped). */
export function computeMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

/** EMA - Exponential Moving Average */
export function computeEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length === 0) return result;
  const multiplier = 2 / (period + 1);
  let ema = closes[0];
  result[0] = ema;
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * multiplier + ema * (1 - multiplier);
    result[i] = ema;
  }
  return result;
}

/** MACD - returns MACD line, signal line, and histogram */
export function computeMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const result: { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } = {
    macd: new Array(closes.length).fill(null),
    signal: new Array(closes.length).fill(null),
    histogram: new Array(closes.length).fill(null),
  };
  if (closes.length <= slowPeriod) return result;

  const emaFast = computeEMA(closes, fastPeriod);
  const emaSlow = computeEMA(closes, slowPeriod);
  const macdLine: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine[i] = emaFast[i]! - emaSlow[i]!;
    }
  }

  // Compute signal = EMA of macdLine
  const signalMultiplier = 2 / (signalPeriod + 1);
  let signalEma = 0;
  let firstSignal = true;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) continue;
    if (firstSignal) {
      signalEma = macdLine[i]!;
      firstSignal = false;
    } else {
      signalEma = macdLine[i]! * signalMultiplier + signalEma * (1 - signalMultiplier);
    }
    result.macd[i] = macdLine[i];
    result.signal[i] = signalEma;
    result.histogram[i] = macdLine[i]! - signalEma;
  }

  return result;
}

/** Bollinger Bands - upper, middle (SMA), lower */
export function computeBollingerBands(
  closes: number[],
  period = 20,
  multiplier = 2
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
} {
  const result: {
    upper: (number | null)[];
    middle: (number | null)[];
    lower: (number | null)[];
  } = {
    upper: new Array(closes.length).fill(null),
    middle: new Array(closes.length).fill(null),
    lower: new Array(closes.length).fill(null),
  };
  if (closes.length < period) return result;

  const sma = computeMA(closes, period);
  for (let i = period - 1; i < closes.length; i++) {
    const mean = sma[i]!;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - mean) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    result.middle[i] = mean;
    result.upper[i] = mean + multiplier * std;
    result.lower[i] = mean - multiplier * std;
  }
  return result;
}

/** VWAP - Volume Weighted Average Price */
export function computeVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length === 0) return result;
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < closes.length; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += typical * volumes[i];
    cumV += volumes[i];
    if (cumV > 0) result[i] = cumPV / cumV;
  }
  return result;
}

/** Classic Wilder RSI over `period` closes (default 14). */
export function computeRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

/** WMA - linearly weighted moving average (most recent bar weighted heaviest). */
export function computeWMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < closes.length; i++) {
    let weighted = 0;
    for (let j = 0; j < period; j++) {
      weighted += closes[i - j] * (period - j);
    }
    result[i] = weighted / denom;
  }
  return result;
}

/** ATR - Wilder's Average True Range over `period` bars (default 14). */
export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  const trueRanges: number[] = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      trueRanges[i] = highs[i] - lows[i];
      continue;
    }
    trueRanges[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trueRanges[i];
  atr /= period;
  result[period] = atr;

  for (let i = period + 1; i < closes.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = atr;
  }

  return result;
}

/** Stochastic Oscillator - %K (fast) and %D (SMA of %K). */
export function computeStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const k: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > highest) highest = highs[j];
      if (lows[j] < lowest) lowest = lows[j];
    }
    const range = highest - lowest;
    k[i] = range === 0 ? 100 : ((closes[i] - lowest) / range) * 100;
  }
  const d = computeMA(k.map((v) => v ?? NaN), dPeriod).map((v, i) =>
    v !== null && k[i] !== null && !Number.isNaN(v) ? v : null
  );
  return { k, d };
}

/** CCI - Commodity Channel Index over `period` bars (default 20). */
export function computeCCI(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20
): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  const typical = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += typical[j];
    const sma = sum / period;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(typical[j] - sma);
    meanDev /= period;
    result[i] = meanDev === 0 ? 0 : (typical[i] - sma) / (0.015 * meanDev);
  }
  return result;
}

/** Williams %R over `period` bars (default 14). Ranges from -100 to 0. */
export function computeWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > highest) highest = highs[j];
      if (lows[j] < lowest) lowest = lows[j];
    }
    const range = highest - lowest;
    result[i] = range === 0 ? 0 : ((highest - closes[i]) / range) * -100;
  }
  return result;
}

/** OBV - On Balance Volume, a running cumulative sum. */
export function computeOBV(closes: number[], volumes: number[]): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length === 0) return result;
  let obv = 0;
  result[0] = obv;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    result[i] = obv;
  }
  return result;
}

/** ADX - Wilder's Average Directional Index over `period` bars (default 14). */
export function computeADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n <= period * 2) return result;

  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  let smoothTR = 0, smoothPlusDM = 0, smoothMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dx: (number | null)[] = new Array(n).fill(null);
  const diAt = (pDM: number, mDM: number, trSum: number) => {
    const plusDI = trSum === 0 ? 0 : (pDM / trSum) * 100;
    const minusDI = trSum === 0 ? 0 : (mDM / trSum) * 100;
    const sum = plusDI + minusDI;
    return sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  };
  dx[period] = diAt(smoothPlusDM, smoothMinusDM, smoothTR);

  for (let i = period + 1; i < n; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    dx[i] = diAt(smoothPlusDM, smoothMinusDM, smoothTR);
  }

  // ADX = Wilder-smoothed average of DX
  let adx = 0;
  let count = 0;
  let firstAdxIndex = -1;
  for (let i = period; i < period * 2 && i < n; i++) {
    if (dx[i] !== null) {
      adx += dx[i]!;
      count++;
    }
  }
  if (count === 0) return result;
  adx /= count;
  firstAdxIndex = Math.min(period * 2 - 1, n - 1);
  result[firstAdxIndex] = adx;

  for (let i = firstAdxIndex + 1; i < n; i++) {
    if (dx[i] === null) continue;
    adx = (adx * (period - 1) + dx[i]!) / period;
    result[i] = adx;
  }

  return result;
}

/** Parabolic SAR (stop-and-reverse) — classic Wilder trend-following overlay. */
export function computeParabolicSAR(
  highs: number[],
  lows: number[],
  step = 0.02,
  maxStep = 0.2
): (number | null)[] {
  const n = highs.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < 2) return result;

  let isLong = highs[1] >= highs[0];
  let sar = isLong ? lows[0] : highs[0];
  let extremePoint = isLong ? highs[0] : lows[0];
  let af = step;
  result[0] = sar;

  for (let i = 1; i < n; i++) {
    sar = sar + af * (extremePoint - sar);

    if (isLong) {
      sar = Math.min(sar, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1]);
      if (lows[i] < sar) {
        isLong = false;
        sar = extremePoint;
        extremePoint = lows[i];
        af = step;
      } else {
        if (highs[i] > extremePoint) {
          extremePoint = highs[i];
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      sar = Math.max(sar, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1]);
      if (highs[i] > sar) {
        isLong = true;
        sar = extremePoint;
        extremePoint = highs[i];
        af = step;
      } else {
        if (lows[i] < extremePoint) {
          extremePoint = lows[i];
          af = Math.min(af + step, maxStep);
        }
      }
    }

    result[i] = sar;
  }

  return result;
}

/** VWMA - Volume Weighted Moving Average over `period` bars. */
export function computeVWMA(closes: number[], volumes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let pv = 0, v = 0;
    for (let j = i - period + 1; j <= i; j++) {
      pv += closes[j] * volumes[j];
      v += volumes[j];
    }
    result[i] = v === 0 ? null : pv / v;
  }
  return result;
}

/** Keltner Channels - EMA basis with ATR-based upper/lower bands. */
export function computeKeltnerChannels(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
  atrPeriod = 10,
  multiplier = 2
): { upper: (number | null)[]; lower: (number | null)[] } {
  const basis = computeEMA(closes, period);
  const atr = computeATR(highs, lows, closes, atrPeriod);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (basis[i] !== null && atr[i] !== null) {
      upper[i] = basis[i]! + multiplier * atr[i]!;
      lower[i] = basis[i]! - multiplier * atr[i]!;
    }
  }
  return { upper, lower };
}

/** Donchian Channels - highest high / lowest low over `period` bars. */
export function computeDonchianChannels(
  highs: number[],
  lows: number[],
  period = 20
): { upper: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = new Array(highs.length).fill(null);
  const lower: (number | null)[] = new Array(lows.length).fill(null);
  for (let i = period - 1; i < highs.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

/**
 * SuperTrend - ATR-based trend-following overlay. Returns the trend line value
 * plus its direction (true = uptrend / support below price) per bar, so callers
 * can color or split the line by trend if desired; this implementation plots it
 * as a single line.
 */
export function computeSuperTrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  multiplier = 3
): { value: (number | null)[]; isUptrend: (boolean | null)[] } {
  const n = closes.length;
  const value: (number | null)[] = new Array(n).fill(null);
  const isUptrend: (boolean | null)[] = new Array(n).fill(null);
  const atr = computeATR(highs, lows, closes, period);
  if (n <= period) return { value, isUptrend };

  let prevUpperBand = 0, prevLowerBand = 0, prevSuperTrend = 0, trendUp = true;

  for (let i = period; i < n; i++) {
    const a = atr[i];
    if (a === null) continue;
    const mid = (highs[i] + lows[i]) / 2;
    let upperBand = mid + multiplier * a;
    let lowerBand = mid - multiplier * a;

    if (value[i - 1] !== null) {
      if (upperBand > prevUpperBand && closes[i - 1] <= prevUpperBand) upperBand = prevUpperBand;
      if (lowerBand < prevLowerBand && closes[i - 1] >= prevLowerBand) lowerBand = prevLowerBand;
    }

    if (prevSuperTrend === prevUpperBand) {
      trendUp = closes[i] <= upperBand;
    } else {
      trendUp = closes[i] >= lowerBand;
    }

    const superTrend = trendUp ? lowerBand : upperBand;
    value[i] = superTrend;
    isUptrend[i] = trendUp;

    prevUpperBand = upperBand;
    prevLowerBand = lowerBand;
    prevSuperTrend = superTrend;
  }

  return { value, isUptrend };
}

/** Momentum - closes[i] minus closes[i - period]. */
export function computeMomentum(closes: number[], period = 10): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] - closes[i - period];
  }
  return result;
}

/** ROC - Rate of Change, percentage form of momentum. */
export function computeROC(closes: number[], period = 12): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const base = closes[i - period];
    result[i] = base === 0 ? null : ((closes[i] - base) / base) * 100;
  }
  return result;
}

/** MFI - Money Flow Index, a volume-weighted RSI variant. Ranges 0-100. */
export function computeMFI(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 14
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return result;

  const typical = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const rawFlow = typical.map((tp, i) => tp * volumes[i]);

  for (let i = period; i < n; i++) {
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typical[j] > typical[j - 1]) posFlow += rawFlow[j];
      else if (typical[j] < typical[j - 1]) negFlow += rawFlow[j];
    }
    if (negFlow === 0) result[i] = 100;
    else {
      const moneyRatio = posFlow / negFlow;
      result[i] = 100 - 100 / (1 + moneyRatio);
    }
  }

  return result;
}

/** TRIX - triple-smoothed EMA rate of change, in percent. */
export function computeTRIX(closes: number[], period = 15): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const ema1 = computeEMA(closes, period);
  const ema1Clean = ema1.map((v) => v ?? closes[0]);
  const ema2 = computeEMA(ema1Clean, period);
  const ema3 = computeEMA(ema2.map((v) => v ?? closes[0]), period);

  for (let i = period * 3; i < n; i++) {
    const prev = ema3[i - 1];
    const curr = ema3[i];
    if (prev === null || curr === null || prev === 0) continue;
    result[i] = ((curr - prev) / prev) * 100;
  }

  return result;
}
