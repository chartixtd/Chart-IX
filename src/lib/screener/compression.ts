import { getFuturesKlines } from "@/lib/bingx/market";

/**
 * 压缩度 = 最近 6 小时振幅 ÷ 最近 24 小时振幅，**越小越靠前**。
 *
 * 它问的是「这个币最近这几小时相对它自己这一天，安静到什么程度」——
 * 比值小 = 一天里动过、但眼下缩在一个很窄的区间里，也就是蓄势。
 * 用比值而不是绝对振幅，是为了跨币可比：一个日振幅 30% 的土狗缩到 3%
 * 和一个日振幅 4% 的大币缩到 3%，绝对值一样，含义完全相反。
 *
 * **数据来自 BingX 公开 K 线，不是 CoinGlass。** 这一层要在选币之前对
 * **全池**（约 250 个币）算出来，而 CoinGlass 明细层每轮只够扫 24 个币
 * （75 次/分钟 ÷ 每币 3 次）。BingX 的 K 线接口不占那份配额，实测全池
 * 250 个币并发 8 拉完只要 2.1 秒、零限流。
 *
 * 24h 与 6h 两个振幅都从**同一批 K 线**算，而不是 24h 用 ticker、6h 用
 * K 线：ticker 的 24 小时窗口是从此刻往回滚的，K 线窗口是按整点对齐的，
 * 两者混用时这个比值的分子分母根本不是同一段时间的比较。
 */

/** 24 小时 = 48 根 30 分钟。 */
export const COMPRESSION_BARS_24H = 48;

/** 6 小时 = 12 根 30 分钟。跟点火的回看窗口同宽。 */
export const COMPRESSION_BARS_6H = 12;

/** 全池拉 K 线的并发。实测 8 / 16 / 32 都零限流，取 8 留足余量。 */
const FETCH_CONCURRENCY = 8;

interface Bar {
  high: number;
  low: number;
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
 * 从 48 根 30 分钟 K 线算压缩度。数据不足或算不出来返回 null。
 *
 * 24h 振幅为 0 时返回 null 而不是 0——一整天一动不动的币不是「压缩到极致」，
 * 是这个标的根本没有交易，把它排到榜首是错的。
 */
export function compressionRatio(bars: Bar[]): number | null {
  if (bars.length < COMPRESSION_BARS_24H) return null;

  const day = bars.slice(-COMPRESSION_BARS_24H);
  const recent = bars.slice(-COMPRESSION_BARS_6H);

  const amp24 = amplitude(day);
  const amp6 = amplitude(recent);
  if (amp24 === null || amp6 === null || amp24 <= 0) return null;

  const ratio = amp6 / amp24;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * 给全池算压缩度。拉不到 K 线的币不进结果 Map。
 *
 * 单个币失败只丢它自己，不影响整批——一个币的 K 线拿不到就把整轮扫描
 * 拖垮，是这套流水线里最不该出现的失败模式。
 */
export async function fetchCompression(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= symbols.length) return;
      const symbol = symbols[i];
      try {
        const bars = await getFuturesKlines(symbol, "30m", COMPRESSION_BARS_24H);
        const ratio = compressionRatio(bars);
        if (ratio !== null) out.set(symbol, ratio);
      } catch {
        // 静默跳过：调用方对「查不到压缩度」的处理见 pipeline 的选币段。
      }
    }
  }

  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return out;
}
