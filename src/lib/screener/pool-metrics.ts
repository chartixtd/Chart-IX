import { getFuturesKlines } from "@/lib/bingx/market";

/**
 * 选币用的两个全池指标，来自**同一批 K 线、同一次请求**。
 *
 *   压缩度 = 最近 6 小时振幅 ÷ 最近 24 小时振幅   （越小越靠前）
 *   量能比 = 最近 24 小时成交额 ÷ 14 天日均成交额  （< 0.8 剔除）
 *
 * **为什么走 BingX 而不是 CoinGlass。** 这两个指标都要在选币**之前**对全池
 * （约 250 个币）算出来，而 CoinGlass 明细层每轮只够扫 24 个币
 * （75 次/分钟 ÷ 每币 3 次）。BingX 的公开 K 线不占那份配额。
 *
 * **为什么一次拉 672 根而不是分两次拉。** 压缩度只要 48 根、量能比要 672 根，
 * 分两趟看起来更省流量，但实测**全池连着打两趟会撞 BingX 的限流**（第二趟
 * 250 个全失败；隔几秒单独再跑就全过）。一趟拉够 672 根：250 个币并发 8
 * 用时 4.4 秒、16MB、零失败。流量换的是「不会因为限流整轮空榜」。
 *
 * **两个指标的分子分母都在这一批 K 线里，所以天然同源。** 这是量能比最容易
 * 出错的地方：拿 pairs-markets 的 24h 成交额（全交易所求和）去除以 K 线算的
 * 日均（单交易所），同一个币两个口径实测差 1.3x 到 28.3x，算出来的不是
 * 「萎缩」，是两个口径的差。
 *
 * 已知局限：BingX 长尾币的成交额被拍平过（516 个永续里 144 个全挤在
 * 619–691 万这个 0.73M 宽的带里）。那种币的量能比会趋近 1、直接放行——
 * 也就是这道门对它们**不生效**，而不是把它们误杀。方向是保守的。
 */

/** 24 小时 = 48 根 30 分钟。压缩度的分母、量能比的分子。 */
export const BARS_24H = 48;

/** 6 小时 = 12 根 30 分钟。压缩度的分子，跟点火的回看窗口同宽。 */
export const BARS_6H = 12;

/** 14 天 = 672 根 30 分钟。量能比的分母。 */
export const BARS_14D = 672;

/** 量能比下限。低于这条线视为成交量正在萎缩。 */
export const VOLUME_RATIO_MIN = 0.8;

/** 最少要有这么多根才算得出日均——不足两天的样本除出来的「日均」没有意义。 */
const MIN_BARS_FOR_RATIO = BARS_24H * 2;

/** 全池拉 K 线的并发。实测 8 / 16 / 32 都零限流，取 8 留足余量。 */
const FETCH_CONCURRENCY = 8;

interface Bar {
  high: number;
  low: number;
  /** 计价货币成交额（≈USDT）。用它而不是 base volume：14 天里价格会变， */
  /** 同样的币数量在不同价位代表的资金完全不同。 */
  quoteVolume: number;
}

export interface PoolMetrics {
  /** 6h振幅 ÷ 24h振幅，选币的排序键 */
  compression: number;
  /** 24h成交额 ÷ 14天日均成交额；算不出来是 null，调用方对 null 一律放行 */
  volumeRatio: number | null;
}

/** 一段 K 线的振幅 %：(最高 − 最低) ÷ 最低。取不到有限值返回 null。 */
function amplitude(bars: Bar[]): number | null {
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (Number.isFinite(b.high) && b.high > high) high = b.high;
    if (Number.isFinite(b.low) && b.low < low) low = b.low;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;
  const amp = ((high - low) / low) * 100;
  return Number.isFinite(amp) ? amp : null;
}

/**
 * 压缩度。数据不足或算不出来返回 null。
 *
 * 24h 振幅为 0 时返回 null 而不是 0——一整天一动不动的币不是「压缩到极致」，
 * 是这个标的根本没有交易，把它排到榜首是错的。
 */
export function compressionRatio(bars: Bar[]): number | null {
  if (bars.length < BARS_24H) return null;

  const amp24 = amplitude(bars.slice(-BARS_24H));
  const amp6 = amplitude(bars.slice(-BARS_6H));
  if (amp24 === null || amp6 === null || amp24 <= 0) return null;

  const ratio = amp6 / amp24;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * 量能比。数据不足或算不出来返回 null。
 *
 * 日均按**实际拿到的根数**折算，不写死 14 天：上游给多少根不由我们决定，
 * 写死天数会让这个比值在拿到的根数变少时静默变成另一个东西。
 */
export function volumeRatio(bars: Bar[]): number | null {
  if (bars.length < MIN_BARS_FOR_RATIO) return null;

  let total = 0;
  for (const b of bars) {
    if (!Number.isFinite(b.quoteVolume) || b.quoteVolume < 0) return null;
    total += b.quoteVolume;
  }

  let recent = 0;
  for (let i = bars.length - BARS_24H; i < bars.length; i++) recent += bars[i].quoteVolume;

  const avgDaily = total / (bars.length / BARS_24H);
  if (!Number.isFinite(avgDaily) || avgDaily <= 0) return null;

  const ratio = recent / avgDaily;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * 给全池算这两个指标。**压缩度算不出来的币不进结果 Map**——它是排序键，
 * 没有键就没法排队。量能比算不出来的仍然进，只是 volumeRatio 为 null。
 *
 * 单个币失败只丢它自己：一个币的 K 线拿不到就把整轮扫描拖垮，是这套
 * 流水线里最不该出现的失败模式。
 */
export async function fetchPoolMetrics(symbols: string[]): Promise<Map<string, PoolMetrics>> {
  const out = new Map<string, PoolMetrics>();
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= symbols.length) return;
      const symbol = symbols[i];
      try {
        const bars = await getFuturesKlines(symbol, "30m", BARS_14D);
        const compression = compressionRatio(bars);
        if (compression === null) continue;
        out.set(symbol, { compression, volumeRatio: volumeRatio(bars) });
      } catch {
        // 静默跳过；调用方对「查不到」的处理见 pipeline 的选币段。
      }
    }
  }

  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return out;
}
