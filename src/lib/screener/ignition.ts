import type { CoinGlassPriceBar, CoinGlassOiBar } from "@/lib/coinglass/types";
import { toFiniteNumber } from "@/lib/coinglass/types";

/**
 * 点火：价格刚刚突破最近 N 根 K 线的区间。
 *
 * **这是整套系统里唯一一个没有确认延迟的触发条件。** 六场景锚在已确认的
 * 摆动点上（PIVOT_N=2），要等 2 根 30 分钟 K 线走完才算数——也就是结构
 * 真的翻掉之后，还要过 1 小时才判得出来。等到那时候，「刚启动」早就
 * 不成立了。点火只看当前这根收盘价有没有越过前 N 根的高低点，
 * **当根收盘即可判定，延迟最多 30 分钟**。
 *
 * 实测（50 个币、528 个不重叠时点、84 次点火，前瞻 12 小时）：
 *   · 只要点火，延续中位 6.1% / 回吐中位 1.3%，延续占比 82%
 *   · 再叠加「24h 振幅最低 1/3」的选币，延续占比升到 85%、胜率 83%
 *   · 反过来叠加「24h 振幅最高 1/3」，延续占比塌到 21%——跟对方向也倒亏
 *
 * 也就是说：**点火本身是信号，选币负责别把它毁掉**。
 */

/**
 * 回看多少根。12 根 30 分钟 = 6 小时。
 *
 * 窗口太短（比如 2 小时）会把日内噪音当成突破，太长（24 小时）又会等到
 * 行情走完一大截才算「突破」。6 小时是实测那一版用的窗口，也是这份数据
 * 支持的唯一一个——换窗口要重新测，别凭感觉调。
 */
export const IGNITION_LOOKBACK_BARS = 12;

/**
 * 点火之后最多还认多少根 K 线。8 根 30 分钟 = 4 小时。
 *
 * 这道上限是**卡片能存在多久**的天花板，跟六场景卡片的 4 小时"陈旧"线
 * 对齐（见 AlertCard 的 freshness）。理由一样：这类信号实测的生命周期是
 * 几十分钟到几小时，超过 4 小时之后它已经从"入场信号"退化成"趋势确认"，
 * 还挂在警报栏里只会让人照着一个过期的位置进场。
 */
export const IGNITION_MAX_AGE_BARS = 8;

/** ATR 的回看根数。14 根 30 分钟 = 7 小时，跟点火自己的 6 小时窗口是同一个量级。 */
export const IGNITION_ATR_BARS = 14;

/**
 * 点火那根 K 线的量能比下限 = 该根成交额 ÷ 之前 12 根的均值。
 *
 * 没有量的突破多半是**流动性真空里的一根针**——盘口薄的时候几十万美元
 * 就能把价格推出区间，然后原样掉回来。要求放量 1.5 倍，是要求这次突破
 * 背后真的有人在换手，而不是无人区里的一次滑动。
 *
 * 用的是价格 K 线自带的 volume_usd（下单盘口 BingX 的量），不是聚合的
 * taker 序列：这里比的是**同一根 K 线自己**的量和它前面 12 根的量，
 * 同源比值最干净，也不需要跨序列对齐。代价是 BingX 长尾的成交额被拍平过
 * （见 universe.ts 底部记录），那种币算出来的比值会趋近 1、被这道门挡掉——
 * 方向是保守的（漏掉，不是误放），可以接受。
 */
export const IGNITION_VOLUME_RATIO_MIN = 1.5;

/** 量能比的回看根数。跟点火自己的区间窗口同宽，比的是「相对刚才」。 */
export const IGNITION_VOLUME_BARS = 12;

/**
 * 失效线在区间边界之外让多少个 ATR。
 *
 * **这个缓冲不是"留点余量"的直觉，是量出来的。** 773 个真实点火事件
 * （50 个币、30m K 线、前瞻 6 小时、不重叠窗口）：
 *
 *   失效线放在区间边界上   6h 内被打穿 84%   实际吃到的 MFE 中位 0.00%
 *   往外让 1.0×ATR         被打穿 53%        MFE 中位 1.47%
 *   往外让 1.5×ATR         被打穿 40%        MFE 中位 1.77%
 *
 * 「吃到 0.00%」那一格是关键：把线画在边界上，一半以上的情况价格在走出
 * 任何东西之前就先回来碰一下，信号当场作废。而被打穿的事件里有 37% 后来
 * 仍然走到了 ≥2%——那些全是被一条画得太紧的线白白丢掉的。
 *
 * 放宽的代价接近于零：中位「因为线更远而少吃到的幅度」是 0.00%。
 *
 * 取 1.0 而不是 1.5：1.5 能再少 13 个百分点的误杀，但它同时会让真正走坏
 * 的信号多挂一阵子——这套系统撤卡撤得快是有价值的（收盘站回区间的卡
 * MFE 中位 1.34%，没站回去的 3.47%，2.6 倍的区分度）。1.0 是这两件事的
 * 折中，而且它正好落在「点火当下的距离中位 0.38%」的三倍左右，
 * 足够跨过日内噪音。
 *
 * 注意**点火的判定线仍然是区间边界本身**（收盘越过才算突破），只有失效线
 * 往外让。两者本来就是两件事：一个问「启动了没」，一个问「还成立吗」。
 */
export const IGNITION_STOP_ATR_MULT = 1.0;

export interface Ignition {
  /** 突破方向：向上突破前高 / 向下跌破前低 */
  direction: "up" | "down";
  /** 被突破的那个区间边界价。这是**点火线**，不是失效线 */
  level: number;
  /**
   * 失效价：区间边界往外让 IGNITION_STOP_ATR_MULT 个 ATR。
   *
   * 曾经直接用 level 当失效线，实测下来那条线 84% 会被打穿、而且中位情况下
   * 你在行情走出任何东西之前就已经作废了（见 IGNITION_STOP_ATR_MULT）。
   *
   * 在点火那一根就算好并固定下来，不随后续 K 线滚动——一条会自己移动的
   * 失效线没法当判据，也没法让人照着操作。
   */
  invalidationPrice: number;
  /** 现价相对 level 的突破幅度，% —— 刚越过线和暴力拉穿是两回事 */
  distancePct: number;
  /** 点火那根 K 线的时刻，ms epoch */
  ignitedAt: number;
  /** 点火到现在过了几根 K 线。0 = 就是当前这根 */
  barsAgo: number;
  /** 点火那根的成交额 ÷ 之前 12 根均值。见 IGNITION_VOLUME_RATIO_MIN */
  volumeRatio: number;
  /** 点火那根的 OI 变化 %，必须为正才算数。见 detectIgnition 第 ⑤ 步 */
  oiChangePct: number;
}

/**
 * 截至第 i 根（不含）的 ATR，以**价格百分比**返回。
 *
 * 用百分比而不是绝对值，是因为这个池子里的币价差着好几个数量级
 * （BTC 八万、PEPE 0.00001），绝对值没法跨币比较，也没法写进一个常量。
 */
function atrPctBefore(bars: CoinGlassPriceBar[], i: number, period: number, ref: number): number {
  let sum = 0;
  let n = 0;
  for (let k = Math.max(1, i - period); k < i; k++) {
    const h = parseFloat(bars[k].high);
    const l = parseFloat(bars[k].low);
    const pc = parseFloat(bars[k - 1].close);
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) continue;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    n++;
  }
  if (n === 0 || !Number.isFinite(ref) || ref <= 0) return 0;
  return (sum / n / ref) * 100;
}

/** 单根 K 线相对它**之前** lookback 根的突破判定。不含自己，否则永远突破不了。 */
function breakoutAt(
  bars: CoinGlassPriceBar[],
  i: number,
  lookback: number
): { direction: "up" | "down"; level: number } | null {
  const from = i - lookback;
  if (from < 0) return null;

  const close = parseFloat(bars[i].close);
  if (!Number.isFinite(close) || close <= 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (let j = from; j < i; j++) {
    const h = parseFloat(bars[j].high);
    const l = parseFloat(bars[j].low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;

  if (close > high) return { direction: "up", level: high };
  if (close < low) return { direction: "down", level: low };
  return null;
}

/**
 * 第 i 根的成交额 ÷ 之前 period 根的均值。算不出来返回 null。
 *
 * 均值分母用**实际累加到的根数**而不是 period：靠近序列头部时可用的根数
 * 不足，写死 period 会把均值算小、比值算大，于是最早那几根永远「放量」。
 */
function volumeRatioAt(bars: CoinGlassPriceBar[], i: number, period: number): number | null {
  const here = parseFloat(bars[i].volume_usd);
  if (!Number.isFinite(here) || here < 0) return null;

  let sum = 0;
  let n = 0;
  for (let k = Math.max(0, i - period); k < i; k++) {
    const v = parseFloat(bars[k].volume_usd);
    if (!Number.isFinite(v) || v < 0) continue;
    sum += v;
    n++;
  }
  if (n === 0) return null;
  const avg = sum / n;
  if (!Number.isFinite(avg) || avg <= 0) return null;

  const ratio = here / avg;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * 第 i 根相对前一根的 OI 变化 %。取不到有限值返回 null（交给调用方否掉）。
 *
 * i 是最后一根（barsAgo=0，也就是刚点火那一刻）时，读的是**实时快照**——
 * 含义是「距上一根收盘以来 OI 涨了没」，这个问法本身成立，但它覆盖的时长
 * 取决于扫描落在这根 K 线的第几分钟（1 到 29 分钟不等）。实测依据见
 * coinglass/open-interest.ts 顶部那段。
 */
function oiChangeAt(oiBars: CoinGlassOiBar[], i: number): number | null {
  if (i < 1 || i >= oiBars.length) return null;
  const prev = toFiniteNumber(oiBars[i - 1].close);
  const curr = toFiniteNumber(oiBars[i].close);
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/**
 * 找出当前**仍然成立**的那次点火，并锚到它开始的那一根。
 *
 * 早先这个函数只看最后一根有没有突破。那样做检测是对的，但**没法拿来做
 * 卡片**：突破只在那一根上成立，下一轮扫描就判不出来了，卡片会闪一下
 * 就消失。实测的后果更直接——主扫描表的点火列 20 行全是空的，因为
 * "恰好这一根在突破"是个很小概率的瞬间。
 *
 * 现在改成三步：
 *   ① 从最后一根往回找，在 maxAge 根之内找到最近一次突破；
 *   ② 沿着连续突破的那一串往回走到**第一根**，它才是点火时刻（ignitedAt）——
 *      锚在这里，钥匙才是稳定的，卡片的首次价与计时才不会每轮重置；
 *   ③ 现价必须仍在 level 之外，否则这次点火已经熄了，返回 null。
 *
 * 突破之后横盘（不再创新高）不会让卡片消失——第 ③ 步看的是"有没有守住
 * 那条线"，不是"有没有继续突破"。只有价格收回区间内才算失败。
 *
 * 整段一律用**收盘价**，跟六场景的失效判定刻意相反（那边用区间极值，
 * 插针也算数）。两者要防的是相反的错误：失效怕漏判，点火怕误判——
 * 影线穿一下又收回来正是最典型的假突破。
 *
 * 一串连续突破中间断了、之后又突破，会被当成**一次新的点火**（钥匙变、
 * 重新计时）。这是有意的：盘整之后再次突破，本来就是一个新的入场时点。
 */
export function detectIgnition(
  bars: CoinGlassPriceBar[],
  /**
   * 与 bars **同下标同时刻**的 OI 序列。流水线保证这一点（三条序列同长度
   * 同粒度一起拉，见 pipeline.ts 明细层）。长度对不上时 OI 那道门会因为
   * 取不到有限值而直接否掉这次点火——宁可漏，不要拿错位的 OI 去放行。
   */
  oiBars: CoinGlassOiBar[],
  lookback: number = IGNITION_LOOKBACK_BARS,
  maxAgeBars: number = IGNITION_MAX_AGE_BARS
): Ignition | null {
  const last = bars.length - 1;
  if (last < lookback) return null;

  // ① 最近一次突破
  const oldest = Math.max(lookback, last - maxAgeBars);
  let at = -1;
  let hit: { direction: "up" | "down"; level: number } | null = null;
  for (let i = last; i >= oldest; i--) {
    const b = breakoutAt(bars, i, lookback);
    if (b) {
      at = i;
      hit = b;
      break;
    }
  }
  if (!hit || at < 0) return null;

  // ② 往回走到这一串连续同向突破的头一根。
  //
  // **边界是 lookback，不是 oldest。** 这里曾经也用 oldest 收边，而 oldest 是
  // 随最后一根一起往前爬的（last - maxAgeBars），于是一串长过 maxAge 的连续
  // 突破里，origin 会被顶在 oldest 上、跟着每根新 K 线往前挪一格——ignitedAt
  // 每 30 分钟换一个值。
  //
  // 后果不在这个函数里，而在它下游：备忘钥匙是 `symbol|ignition|方向|ignitedAt`
  // （见 cards.ts 的 ignitionMemoKey），钥匙一变，这张卡在系统眼里就是全新的
  // 结构事件——首次价与计时重置，Telegram 每半小时把同一次点火重推一遍，
  // 而下面第 ④ 步那道 4 小时上限因为 barsAgo 被永远钉在 maxAgeBars 上，
  // 一次都不会生效。ignitionMemoKey 顶上那段注释说「锚在 ignitedAt 钥匙才稳
  // 得住」，而这一行让它并没有稳住。
  //
  // 走到 lookback 为止：再往前 breakoutAt 算不出来（它需要之前 lookback 根）。
  let origin = at;
  let level = hit.level;
  while (origin - 1 >= lookback) {
    const prev = breakoutAt(bars, origin - 1, lookback);
    if (!prev || prev.direction !== hit.direction) break;
    origin -= 1;
    level = prev.level;
  }

  // ③ 现价还守着失效线吗。
  //
  // **守的是失效线，不是区间边界。** 这里曾经用 level 本身，实测 773 个真实
  // 点火事件里那条线 84% 会被打穿，而且中位情况下你在行情走出任何东西之前
  // 就已经作废（吃到的 MFE 中位 0.00%）。完整数据见 IGNITION_STOP_ATR_MULT。
  const close = parseFloat(bars[last].close);
  if (!Number.isFinite(close) || close <= 0) return null;
  if (!Number.isFinite(level) || level <= 0) return null;

  // 失效线在点火那一根就固定下来，用的也是那一刻的 ATR——一条会随每根新
  // K 线移动的失效线没法当判据，也没法让人照着操作。
  const atr = atrPctBefore(bars, origin, IGNITION_ATR_BARS, level);
  const buffer = (level * atr * IGNITION_STOP_ATR_MULT) / 100;
  const invalidationPrice = hit.direction === "up" ? level - buffer : level + buffer;
  if (!Number.isFinite(invalidationPrice) || invalidationPrice <= 0) return null;

  const alive = hit.direction === "up" ? close > invalidationPrice : close < invalidationPrice;
  if (!alive) return null;

  const ignitedAt = bars[origin].time;
  if (!Number.isFinite(ignitedAt)) return null;

  // ④ 点火本身有多老。
  //
  // 必须拿**真实的** origin 来量，而不是被 oldest 截过的那个。第 ① 步的 oldest
  // 只回答「最近一次突破是不是还在 maxAge 之内」，对一路创新高的行情它永远为真；
  // 真正该被这道上限拦下的正是这种——突破 4 小时之后它已经从「入场信号」退化成
  // 「趋势确认」，还挂在警报栏里只会让人照着一个过期的位置进场（见
  // IGNITION_MAX_AGE_BARS 顶上那段）。
  const barsAgo = last - origin;
  if (barsAgo > maxAgeBars) return null;

  // ⑤ 点火那根必须放量。没量的突破多半是流动性真空里的一根针。
  const volumeRatio = volumeRatioAt(bars, origin, IGNITION_VOLUME_BARS);
  if (volumeRatio === null || volumeRatio < IGNITION_VOLUME_RATIO_MIN) return null;

  // ⑥ 点火那根 OI 必须增加。
  //
  // 价格突破 + OI 上升 = 有**新仓**在推；价格突破 + OI 下降 = 空头回补／
  // 多头平仓推上去的，推力来自正在离场的人，走完就没了。这两件事在 K 线上
  // 长得一模一样，只有 OI 能分开。
  //
  // 比的是点火那根与它前一根的收盘 OI——「这根 K 线期间 OI 是增是减」，
  // 跟「点火」是同一个时刻，不牵扯更早的仓位变化。
  const oiChangePct = oiChangeAt(oiBars, origin);
  if (oiChangePct === null || oiChangePct <= 0) return null;

  return {
    direction: hit.direction,
    level,
    invalidationPrice,
    distancePct: (Math.abs(close - level) / level) * 100,
    ignitedAt,
    barsAgo,
    volumeRatio,
    oiChangePct,
  };
}
