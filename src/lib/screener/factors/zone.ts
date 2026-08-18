import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";

/** 价格全域切多少个桶。50 个桶在 7 天区间上大约是 2% 一档，够分辨价值区边沿。 */
export const ZONE_BUCKETS = 50;

/** 价值区包含的成交额比例。70% 是 Market Profile 的通用定义。 */
export const VALUE_AREA_RATIO = 0.7;

/**
 * 跌破 VAL 之后分数归零的位置。
 *
 * 这是全套四因子里唯一的「接飞刀」风险敞口，所以单独抽成常量：
 * 刚跌破价值区经常是假破（分数仍高，允许抄底），但破到半个价值区宽度之外
 * 说明结构已经坏了，再给分就是在鼓励接刀。要调松紧改这一个数。
 */
export const ZONE_BREAKDOWN_ZERO_AT = -0.5;

/** K 线少于这个数就不算分布——样本太少的「密集区」只是噪音。 */
const MIN_BARS = 24;

export interface VolumeProfile {
  poc: number;
  val: number;
  vah: number;
}

/**
 * 把 7 天的成交额按价格分桶，找出 POC 与 70% 价值区。
 *
 * 每根 K 线的成交额均摊到它 low..high 覆盖的所有桶里，而不是只记在收盘价那一档：
 * 一根穿过 10 个桶的长实体，它的成交显然发生在这一整段上，全算给收盘价
 * 会让分布被最后一根 K 线的收盘位置牵着走。
 */
export function buildVolumeProfile(bars: CoinGlassPriceBar[]): VolumeProfile | null {
  if (bars.length < MIN_BARS) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    const low = parseFloat(b.low);
    const high = parseFloat(b.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    if (low < min) min = low;
    if (high > max) max = high;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  const width = (max - min) / ZONE_BUCKETS;
  const buckets = new Array<number>(ZONE_BUCKETS).fill(0);

  for (const b of bars) {
    const low = parseFloat(b.low);
    const high = parseFloat(b.high);
    const vol = parseFloat(b.volume_usd);
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(vol) || vol <= 0) continue;

    const from = Math.min(ZONE_BUCKETS - 1, Math.max(0, Math.floor((low - min) / width)));
    const to = Math.min(ZONE_BUCKETS - 1, Math.max(0, Math.floor((high - min) / width)));
    const span = to - from + 1;
    const share = vol / span;
    for (let i = from; i <= to; i++) buckets[i] += share;
  }

  const total = buckets.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  let pocIndex = 0;
  for (let i = 1; i < buckets.length; i++) if (buckets[i] > buckets[pocIndex]) pocIndex = i;

  // 从 POC 向两侧扩张，每一步吞掉相邻两侧中成交额更大的那一格，直到覆盖 70%
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = buckets[pocIndex];
  const target = total * VALUE_AREA_RATIO;
  while (acc < target && (lo > 0 || hi < ZONE_BUCKETS - 1)) {
    const below = lo > 0 ? buckets[lo - 1] : -1;
    const above = hi < ZONE_BUCKETS - 1 ? buckets[hi + 1] : -1;
    if (above >= below) {
      hi++;
      acc += buckets[hi];
    } else {
      lo--;
      acc += buckets[lo];
    }
  }

  return {
    poc: min + (pocIndex + 0.5) * width,
    val: min + lo * width,
    vah: min + (hi + 1) * width,
  };
}

/** 现价相对价值区的位置。0 = 贴 VAL，1 = 贴 VAH，可以小于 0 或大于 1。 */
export function zonePosition(price: number, profile: VolumeProfile): number {
  const span = profile.vah - profile.val;
  if (span <= 0) return 0.5;
  return (price - profile.val) / span;
}

/**
 * 做多打分曲线（做空把 pos 换成 1-pos 走同一条）：
 *
 *   [0, 0.35]  → 30   贴价值区下沿，密集筹码就在脚下当支撑
 *   (0.35,0.7] → 30→12 区间中部，无位置优势
 *   (0.7, 1.0] → 12→4  贴上沿，头顶是套牢盘
 *   > 1        → 4     已冲出筹码区，做多即追高
 *   < 0        → 30→0  见 ZONE_BREAKDOWN_ZERO_AT
 */
function curve(pos: number): number {
  if (pos > 1) return 4;
  if (pos >= 0.7) return 12 - ((pos - 0.7) / 0.3) * 8;
  if (pos >= 0.35) return 30 - ((pos - 0.35) / 0.35) * 18;
  if (pos >= 0) return 30;
  const t = pos / ZONE_BREAKDOWN_ZERO_AT; // pos 越负 t 越接近 1
  return t >= 1 ? 0 : 30 * (1 - t);
}

/**
 * 数据不足给中性 15（满分的一半）而不是 0：Zone 是「价格现在处在什么位置」
 * 这种状态型因子，拿不到 K 线不等于位置很差。这跟 Sweep 那种事件型因子
 * 「没数据 = 没发生 = 0 分」的语义相反，两者不要互相看齐。
 */
export function zoneScore(
  price: number,
  bars: CoinGlassPriceBar[],
  direction: Direction
): number {
  const profile = buildVolumeProfile(bars);
  if (!profile || !Number.isFinite(price)) return FACTOR_MAX.zone / 2;
  const pos = zonePosition(price, profile);
  const eff = direction === "long" ? pos : 1 - pos;
  return Math.max(0, Math.min(FACTOR_MAX.zone, curve(eff)));
}
