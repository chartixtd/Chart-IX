import type { CoinGlassPriceBar, CoinGlassOiBar, CoinGlassTakerBar } from "@/lib/coinglass/types";
import { toFiniteNumber } from "@/lib/coinglass/types";
import { findPivots, PIVOT_N, PRICE_EXTREME_MIN_PCT } from "./oi-divergence";

/**
 * 六场景判定层：以价格最近两个已确认摆动点为锚，读同一对时刻之间 CVD 与
 * OI 的变化，把每个币分类成六种场景之一（或无场景）。MSS 不在这一批做。
 *
 * 与 oiDivergence（一个连续的方向调整量）不同，这里产出的是离散分类 +
 * 操作方向 + 陷阱标志，供警报状态机与前端警报卡直接使用——警报要的是
 * 「现在是哪种局面」，不是「往哪边调几分」。
 */
export type ScenarioKind =
  | "healthy_trend"
  | "inventory_flush"
  | "true_top_div"
  | "true_bottom_div"
  | "false_top_div"
  | "false_bottom_div";

export type ScenarioDirection = "long" | "short" | "manage";

export interface Scenario {
  kind: ScenarioKind;
  direction: ScenarioDirection;
  trap: boolean;
  /** 判定锚点：前一个摆动点价格与最新摆动点价格 */
  swingPrev: number;
  swingNow: number;
  /** 两摆动点之间的净流占换手 %、OI 变化 % —— 警报卡的判定句直接用它们 */
  cvdPct: number;
  oiPct: number;
  /** 判定用的是高点侧还是低点侧 */
  side: "high" | "low";
}

/**
 * 以下四个阈值是量出来的，不是拍的（2026-08-19，18 个深度扫描币、17 个
 * 新极值样本，摆动点对之间）：
 *   |CVD净流%| 中位 3.1 · 75% 分位 7.8 · 90% 分位 9.8
 *   |OI差%|   中位 1.2 · 75% 分位 2.9 · 90% 分位 7.3
 * 起判线取中位数下方挡噪音（CVD ±2、OI ±1），「剧烈/暴增」取 90% 分位
 * （CVD ±10、OI +7）。这组阈值下高点侧/低点侧各自的四个格子数学上互斥：
 * OI 的符号分开真背离（OI 收缩，≤-1）与假背离陷阱（OI 暴增，≥+7）；
 * CVD 的符号分开健康趋势/存量清算（同向，≥+2）与背离（逆向，≤-2）。
 */
export const SCENARIO_CVD_ALIGN_MIN = 2;
export const SCENARIO_CVD_EXTREME_MIN = 10;
export const SCENARIO_OI_CHANGE_MIN = 1;
export const SCENARIO_OI_SURGE_MIN = 7;

function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * 单侧（高点侧或低点侧）分类结果，附带 i2（最新摆动点下标）供
 * classifyScenario 在两侧都命中时挑「更晚确认」的那一侧。
 */
interface SideResult {
  scenario: Scenario;
  i2: number;
}

/**
 * 八格判定表的符号方向（写代码前独立推导，避免抄错方向）：
 *
 * 高点侧「同向」= CVD 为正（买盘推着价格创新高，买盘方向与价格方向一致）；
 * 低点侧「同向」= CVD 为负（卖盘推着价格创新低，下跌趋势里「同向」是卖盘
 * 主导，不是买盘）。所以统一用 signedCvd：高点侧 signedCvd = cvdPct，
 * 低点侧 signedCvd = -cvdPct，「正数 signedCvd」在两侧都表示「同向」。
 * 换算之后，四个格子在两侧共用同一套 signedCvd/oiPct 判据，唯一的区别是
 * 「同向」对应的操作方向相反（高点侧同向=多头趋势延续=long；低点侧同向=
 * 空头趋势延续=short）：
 *
 *   signedCvd ≤ -EXTREME 且 oiPct ≥ SURGE
 *     → 假背离陷阱：同向的钱其实是逆势追进来的新仓（OI 暴增），价格顶/底
 *       扛住没被打穿，真正会发生的是这批追单被反向挤爆——高点侧「顺势做多」
 *       （false_top_div/long/trap）、低点侧「顺势做空」（false_bottom_div/
 *       short/trap）。
 *   signedCvd ≤ -ALIGN 且 oiPct ≤ -CHANGE
 *     → 真背离：价格创新极值但资金流逆着走、且 OI 还在收缩（没有新钱托底/
 *       接力），结构最弱——高点侧「反手做空」（true_top_div/short）、
 *       低点侧「反手做多」（true_bottom_div/long）。
 *   signedCvd ≥ ALIGN 且 oiPct ≥ CHANGE
 *     → 健康趋势：资金流与价格同向、OI 同步扩张，新钱在推动——
 *       高点侧「顺势做多」（healthy_trend/long）、低点侧「顺势做空」
 *       （healthy_trend/short）。
 *   signedCvd ≥ ALIGN 且 oiPct ≤ -CHANGE
 *     → 存量清算：资金流同向但 OI 在收缩（老仓位被平掉而非新仓进场），
 *       这是行情要衰竭的信号，不是新趋势——两侧统一给 manage
 *       （inventory_flush/manage）：分批止盈，等反手。
 *
 * 其余组合（包括 signedCvd 落在 (-ALIGN, ALIGN) 内、或 oiPct 落在
 * (-CHANGE, CHANGE) 内）都不命中任何格子，返回 null（无场景）。
 */
function classifyCell(
  side: "high" | "low",
  cvdPct: number,
  oiPct: number
): { kind: ScenarioKind; direction: ScenarioDirection; trap: boolean } | null {
  const signedCvd = side === "high" ? cvdPct : -cvdPct;
  const alignedDirection: ScenarioDirection = side === "high" ? "long" : "short";
  const divergedDirection: ScenarioDirection = side === "high" ? "short" : "long";

  if (signedCvd <= -SCENARIO_CVD_EXTREME_MIN && oiPct >= SCENARIO_OI_SURGE_MIN) {
    return {
      kind: side === "high" ? "false_top_div" : "false_bottom_div",
      // 陷阱格的操作方向是「顺势」，即跟 alignedDirection 一致，不是
      // divergedDirection——这正是「假背离」这个名字的意思：看起来像
      // 背离，实际该顺着原趋势走。
      direction: alignedDirection,
      trap: true,
    };
  }
  if (signedCvd <= -SCENARIO_CVD_ALIGN_MIN && oiPct <= -SCENARIO_OI_CHANGE_MIN) {
    return {
      kind: side === "high" ? "true_top_div" : "true_bottom_div",
      direction: divergedDirection,
      trap: false,
    };
  }
  if (signedCvd >= SCENARIO_CVD_ALIGN_MIN && oiPct >= SCENARIO_OI_CHANGE_MIN) {
    return { kind: "healthy_trend", direction: alignedDirection, trap: false };
  }
  if (signedCvd >= SCENARIO_CVD_ALIGN_MIN && oiPct <= -SCENARIO_OI_CHANGE_MIN) {
    return { kind: "inventory_flush", direction: "manage", trap: false };
  }
  return null;
}

/**
 * 单侧判定：用 findPivots 找最后两个已确认摆动点，检查新极值幅度门槛，
 * 算 cvdPct/oiPct，套进 classifyCell。任何一步的数据不是有限值就返回
 * null——这条规矩与 oiDivergence 一致：下标硬取不报错，只让判定全错，
 * 所以每一步都要显式挡。
 */
function classifySide(
  side: "high" | "low",
  priceValues: number[],
  oiCloses: number[],
  buys: number[],
  sells: number[]
): SideResult | null {
  const pivots = findPivots(priceValues, PIVOT_N, side);
  if (pivots.length < 2) return null;

  const i1 = pivots[pivots.length - 2];
  const i2 = pivots[pivots.length - 1];

  const prevPrice = priceValues[i1];
  const currPrice = priceValues[i2];
  if (!isFiniteNumber(prevPrice) || !isFiniteNumber(currPrice) || prevPrice <= 0) return null;

  // 高点侧要求 curr > prev 才算创新高；低点侧要求 curr < prev 才算创新低。
  const isNewExtreme = side === "high" ? currPrice > prevPrice : currPrice < prevPrice;
  if (!isNewExtreme) return null;

  const priceChangePct = (Math.abs(currPrice - prevPrice) / prevPrice) * 100;
  if (!isFiniteNumber(priceChangePct) || priceChangePct < PRICE_EXTREME_MIN_PCT) return null;

  const prevOi = oiCloses[i1];
  const currOi = oiCloses[i2];
  if (!isFiniteNumber(prevOi) || !isFiniteNumber(currOi) || prevOi <= 0) return null;
  const oiPct = ((currOi - prevOi) / prevOi) * 100;
  if (!isFiniteNumber(oiPct)) return null;

  // cvdPct：区间 (i1, i2]——从 i1 的下一根开始累加到 i2（含），不含 i1 本身。
  // i1 是「上一个」摆动点，它自己那一根的买卖量属于更早一段行情，
  // 不该算进「这两个摆动点之间发生了什么」。
  let netBuy = 0;
  let gross = 0;
  for (let k = i1 + 1; k <= i2; k++) {
    const buy = buys[k];
    const sell = sells[k];
    if (!isFiniteNumber(buy) || !isFiniteNumber(sell)) return null;
    netBuy += buy - sell;
    gross += buy + sell;
  }
  if (gross <= 0) return null;
  const cvdPct = (netBuy / gross) * 100;
  if (!isFiniteNumber(cvdPct)) return null;

  const cell = classifyCell(side, cvdPct, oiPct);
  if (!cell) return null;

  return {
    i2,
    scenario: {
      kind: cell.kind,
      direction: cell.direction,
      trap: cell.trap,
      swingPrev: prevPrice,
      swingNow: currPrice,
      cvdPct,
      oiPct,
      side,
    },
  };
}

/**
 * 六场景判定入口。三条序列长度必须相等（同下标同时刻），否则直接返回
 * null——这条规矩和 oiDivergence 相同：不能拿不同时刻的数据硬凑判定。
 *
 * 高点侧、低点侧各自独立判定；两侧都命中时取 i2 更大（更晚确认）的
 * 那一侧——它是更接近「现在」的结构，旧的那个摆动点对已经是过去式了。
 */
export function classifyScenario(
  priceBars: CoinGlassPriceBar[],
  oiBars: CoinGlassOiBar[],
  takerBars: CoinGlassTakerBar[]
): Scenario | null {
  if (priceBars.length !== oiBars.length || priceBars.length !== takerBars.length) return null;

  // CoinGlassPriceBar 的 high/low 是纯字符串，parseFloat 准确（同
  // oiDivergence 里的注释）；CoinGlassOiBar.close 字段类型逐根不稳定，
  // 必须走 toFiniteNumber；taker bar 的买卖额也是纯字符串。
  const highs = priceBars.map((b) => parseFloat(b.high));
  const lows = priceBars.map((b) => parseFloat(b.low));
  const oiCloses = oiBars.map((b) => toFiniteNumber(b.close));
  const buys = takerBars.map((b) => parseFloat(b.taker_buy_volume_usd));
  const sells = takerBars.map((b) => parseFloat(b.taker_sell_volume_usd));

  const highResult = classifySide("high", highs, oiCloses, buys, sells);
  const lowResult = classifySide("low", lows, oiCloses, buys, sells);

  if (!highResult) return lowResult ? lowResult.scenario : null;
  if (!lowResult) return highResult.scenario;
  // 两侧都命中：i2 相等是理论上才会出现的退化情形（比如同一根 K 线同时是
  // 局部最高点与最低点），此时取高点侧没有特殊含义，只是要有一个确定的
  // 选择、不能让结果随意漂移。
  return highResult.i2 >= lowResult.i2 ? highResult.scenario : lowResult.scenario;
}
