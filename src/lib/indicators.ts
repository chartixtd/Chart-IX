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
