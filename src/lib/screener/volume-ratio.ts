import type { CoinGlassTakerBar } from "@/lib/coinglass/types";
import { toFiniteNumber } from "@/lib/coinglass/types";

/**
 * 量能比 = 最近 24 小时成交额 ÷ 这段序列的日均成交额。
 *
 * 它回答的是「这个币现在的活跃度，相对它自己平时是高还是低」——绝对门槛
 * （SERVER_GATE.minVolumeUsd = 2000万）只能挡掉完全没法交易的币，挡不掉
 * 「平时一天 5 亿、今天只有 8000 万」这种**正在萎缩**的币。后者的绝对量
 * 很漂亮，但行情其实已经走完了，那正是我们最不想选中的东西。
 *
 * **两边必须同源。** 分子分母都取自同一条 aggregated-taker 序列，不能拿
 * pairs-markets 的 24h 成交额去除以 K 线算出来的日均：前者是全交易所求和，
 * 后者只有 CVD 采样的那四家，同一个币两个口径实测差 1.3x 到 28.3x
 * （见 universe.ts 底部那段被删门槛的记录）。混着用算出来的不是「萎缩」，
 * 是两个口径的差。
 */

/** 24 小时 = 48 根 30 分钟。 */
export const VOLUME_RECENT_BARS = 48;

/**
 * 量能比下限。低于这条线视为「成交量正在萎缩」，从候选里剔除。
 *
 * 0.8 的含义：今天的量至少要有平时的八成。留 20% 的余量是因为日内节奏
 * 本来就有波动（亚洲盘 / 欧美盘、周末），卡在 1.0 会把大量正常的币误杀。
 */
export const VOLUME_RATIO_MIN = 0.8;

/** 最少要有这么多根才算得出日均——不足一天的样本除出来的「日均」没有意义。 */
const MIN_BARS = VOLUME_RECENT_BARS * 2;

/** 一根的总成交额 = 主动买 + 主动卖。 */
function barVolume(b: CoinGlassTakerBar): number {
  const buy = toFiniteNumber(b.aggregated_buy_volume_usd);
  const sell = toFiniteNumber(b.aggregated_sell_volume_usd);
  if (!Number.isFinite(buy) || !Number.isFinite(sell)) return NaN;
  return buy + sell;
}

/**
 * 算量能比。数据不足或算不出有限值时返回 null。
 *
 * **返回 null 的正确处理是「不拦」，不是「拦掉」。** 这跟成交量绝对门槛
 * （查不到就当不达标）刻意相反：绝对门槛问的是「这个币能不能交易」，
 * 证明不了就不该推荐；量能比问的是「它是不是在萎缩」，证明不了不等于
 * 它在萎缩，拿一个算不出来的指标去删掉一行只会让榜单无声地变短。
 *
 * 日均按**实际拿到的根数**折算，而不是假定序列一定有多长——上游给多少
 * 根不由我们决定（见 price-history.ts 的 PRICE_HISTORY_LIMIT），
 * 写死天数会让这个比值在上游改了长度之后静默变成另一个东西。
 */
export function volumeRatio(taker: CoinGlassTakerBar[]): number | null {
  if (taker.length < MIN_BARS) return null;

  let total = 0;
  for (const b of taker) {
    const v = barVolume(b);
    if (!Number.isFinite(v)) return null;
    total += v;
  }

  let recent = 0;
  for (let i = taker.length - VOLUME_RECENT_BARS; i < taker.length; i++) {
    recent += barVolume(taker[i]);
  }

  const days = taker.length / VOLUME_RECENT_BARS;
  const avgDaily = total / days;
  if (!Number.isFinite(avgDaily) || avgDaily <= 0) return null;

  const ratio = recent / avgDaily;
  return Number.isFinite(ratio) ? ratio : null;
}
