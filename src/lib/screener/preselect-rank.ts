import type { PreselectCandidate } from "./universe";

/**
 * liquidationAnomaly 的分母下限，美元。与 factors/sweep.ts 的
 * `SWEEP_BASELINE_FLOOR_USD` 踩的是同一个坑：小市值币 24h 爆仓额为 0
 * 是常态，`liq1h / (liq24h / 24)` 在那种情况下会除出 Infinity，
 * 让一笔几百美元的爆仓凭空霸占整个深度扫描名额。
 */
export const LIQ_ANOMALY_FLOOR_USD = 1000;

export interface RankInput {
  candidate: PreselectCandidate;
  /** BingX ticker 的 24h 高低算出的振幅，% */
  amplitude: number;
  /** liquidation/coin-list 的 1h 爆仓额 */
  liq1h: number;
  /** liquidation/coin-list 的 24h 爆仓额 */
  liq24h: number;
}

/**
 * 1h 爆仓额相对「24h 均摊到每小时」的倍数，衡量爆仓是不是突然放大。
 *
 * 除零保护是必需的——小市值币 24h 爆仓额为 0 是常态，分母不设下限会得到
 * Infinity。非有限值输入（NaN/Infinity）直接返回 0：那种数据本身就不可信，
 * 不该被除法运算放大成一个看起来极端但毫无意义的分数。
 */
export function liquidationAnomaly(liq1h: number, liq24h: number): number {
  if (!Number.isFinite(liq1h) || !Number.isFinite(liq24h)) return 0;
  const hourlyBaseline = Math.max(liq24h / 24, LIQ_ANOMALY_FLOOR_USD);
  return liq1h / hourlyBaseline;
}

/**
 * 升序排序后取名次 `/ (n - 1)` 作为百分位，`n === 1` 时给 1
 * （只有一个候选时无所谓排名，直接给满分，也避免除以 0）。
 *
 * 用百分位而不是绝对值缩放去归一化，是这次重构里唯一一处「反直觉但故意」的
 * 设计：爆仓额的分布极度长尾（头部币能比长尾大四五个数量级），
 * 如果用 `value / max(values)` 这种绝对值缩放，除了最大的那几个之外
 * 全部会被压成接近 0，振幅那一半的信号会被完全淹没——排出来的名单
 * 本质上只是「爆仓额最大的 15 个」，振幅完全不起作用。百分位把两个量纲
 * 完全不同、分布形状也完全不同的信号都映射到 [0,1] 上，才能让「各占一半」
 * 这句话真正成立。`rankForDeepScan` 的对比测试用一个爆仓额差 5 个数量级的
 * 池子钉住了这个结论：换成绝对值缩放，那个测试会失败。
 *
 * 并列值必须取「并列区间的平均名次」，不能按各自在数组里的原始位置分别取名次
 * ——这条是写测试时才炸出来的真实 bug，不是理论洁癖：liquidation/coin-list
 * 整体拿不到时，pipeline.ts 会给每个候选都填 `liq1h = liq24h = 0`，
 * 全部候选的爆仓异常度因此完全相等；如果按原始数组顺序摊名次，会凭空按
 * 「谁在数组里排前面」给出 0..1 的假坡度，等于用数组顺序伪造了一个爆仓信号。
 * 并列取平均名次后，全部相等的输入会得到同一个百分位（n 为奇数时严格等于
 * 0.5，偶数时也是同一个常数），这个常数对每个候选都一样，排序完全由另一半
 * （振幅）决定——这正是 pipeline.ts 里「liquidation 拿不到就退化成只按振幅排」
 * 想要的效果，不需要在调用点另外写一条降级分支。
 */
function percentileRank(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const percentiles = new Array<number>(n);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const avgRank = (i + j) / 2;
    const pct = avgRank / (n - 1);
    for (let k = i; k <= j; k++) percentiles[order[k]] = pct;
    i = j + 1;
  }
  return percentiles;
}

/**
 * 按「爆仓异常度」与「振幅」各占一半挑出 limit 个进入明细层。
 *
 * 只挑 limit 个而不是全量深度扫描，是被 CoinGlass 每分钟 80 次调用的真实
 * 配额逼出来的（见 screener/types.ts 的 `DEEP_SCAN_LIMIT` 注释）。这意味着
 * 预排序**必然会漏掉一些币**——尤其是「爆仓平淡但 Zone/OI/CVD 三项本来会
 * 打出高分」的币：这三个因子都要靠明细层的数据才能算，预排序阶段完全看不到，
 * 只能用爆仓与振幅这两个粗筛阶段就有的信号做代理。这是 80/分钟配额下
 * 无法回避的代价，不是实现疏忽——如果 CoinGlass 套餐升级到更高配额，
 * 这里应该是第一个被重新考虑的地方。
 *
 * 同分时用 bingxSymbol 字典序打平，保证结果稳定可复现（不依赖数组原始顺序
 * 或排序算法是否稳定）。
 */
export function rankForDeepScan(inputs: RankInput[], limit: number): PreselectCandidate[] {
  if (inputs.length === 0) return [];

  const liqPercentiles = percentileRank(inputs.map((i) => liquidationAnomaly(i.liq1h, i.liq24h)));
  const ampPercentiles = percentileRank(inputs.map((i) => i.amplitude));

  const scored = inputs.map((input, i) => ({
    candidate: input.candidate,
    score: 0.5 * liqPercentiles[i] + 0.5 * ampPercentiles[i],
  }));

  scored.sort(
    (a, b) => b.score - a.score || a.candidate.bingxSymbol.localeCompare(b.candidate.bingxSymbol)
  );

  return scored.slice(0, limit).map((s) => s.candidate);
}
