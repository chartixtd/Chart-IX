import type { CoinGlassPriceBar, CoinGlassOiBar, CoinGlassTakerBar } from "@/lib/coinglass/types";
import { findPivots, PIVOT_N } from "./oi-divergence";
import {
  cvdLine,
  highs,
  lows,
  closes,
  oiCloses,
  lastTwoPivots,
  pctChange,
  cvdNetPct,
  oiState,
  findSweep,
  CVD_ALIGN_PCT,
  CVD_EXTREME_PCT,
  OI_SURGE_PCT,
} from "./series";
import type { OiState, Sweep } from "./series";

/**
 * 三变量（价格 / CVD / OI）判读引擎。
 *
 * 通用语义层——三个变量各自回答的问题不同，混着看必错：
 *   价格 = 发生了什么（硬门槛：结构有没有破）
 *   CVD  = 谁在推动（**用 swing 比较，不用单根颜色**）
 *   OI   = 有没有新钱（含义模糊，必须配 CVD 才知道是谁在动）
 *
 * OI×CVD 交叉语义（所有场景通用）：
 *   OI减 + CVD跌 = 多头被清算      OI减 + CVD平 = 空头回补
 *   OI增 + CVD跌 = 空头建仓        OI增 + CVD涨 = 多头建仓
 *
 * 冲突优先级：**价格结构 > OI > CVD**。
 *
 * 这一版整个替换了旧的六场景（healthy_trend / inventory_flush / 真假顶底
 * 背离）。旧那套只用「最近两个价格摆动点之间的 CVD 净流与 OI 变化」填一张
 * 四格表，没有前置状态、没有 sweep、也没有 CVD 自己的 swing——而规格里
 * 「CVD 有没有跌破它自己前一个 swing low」正是背离成不成立的判据。
 */

export type ScenarioKind =
  // 做多方向
  | "a1_healthy_pullback" // A1 健康趋势回调
  | "a2_accum_bottom_div" // A2 增仓型底背离（含 OI 减的真底背离）
  | "a3_e1_absorb" // A3 E1 吸筹 + OI 增
  | "a4_e4_flush" // A4 E4 恐慌清算 + OI 企稳
  // 做空方向
  | "b1_healthy_bounce" // B1 健康跌势反弹
  | "b2_distrib_top_div" // B2 增仓型顶背离
  | "b3_e5_distrib" // B3 E5 派发 + OI 增
  | "b4_e8_cover_stall" // B4 E8 回补失速 + OI 企稳
  // 陷阱（独立判定，优先级高于以上所有）
  | "trap_false_top_div" // 假顶背离 → 禁止做空，顺势做多
  | "trap_false_bottom_div"; // 假底背离 → 禁止做多，顺势做空

export type ScenarioDirection = "long" | "short" | "manage";

/** 强度分级，取自规格最后那张汇总表。排除档不产出场景，所以不在这里。 */
export type ScenarioStrength = "strongest" | "trend_best" | "medium" | "healthy";

export interface Scenario {
  kind: ScenarioKind;
  direction: ScenarioDirection;
  trap: boolean;
  strength: ScenarioStrength;
  /**
   * 触发那根 K 线的时刻，ms epoch。
   *
   * 失效判定的窗口起点用它，不用「我们第一次看到这张卡」——后者取决于扫描
   * 什么时候轮到这个币，跟结构本身无关，而且会漏掉最要紧的一类：结构成形
   * 之后、我们看到之前，价格已经走反了。
   */
  triggeredAt: number;
  /** 失效价与穿越方向。规格要求每个场景都有明确失效位，没有就不成立。 */
  invalidation: { price: number; breach: "above" | "below" };
  /** 关键结构位：被扫的 SSL/BSL，或这次判定依托的那个未破 swing */
  structureLevel: number;
  /** 判定区间内的 CVD 净流占换手 %、OI 变化 % —— 卡片判定句直接用 */
  cvdPct: number;
  oiPct: number;
  /**
   * 判定区间内 OI 的**状态分档**，卡片文案的定语从它选词。
   *
   * 存在的理由是一类反复出现的 bug：文案写死了判定并不保证的状态。
   * 上线后同时出现过三处——A2 顶着「**增仓**型」的名字而 OI 是 -2.20%；
   * A4/B4 写「已从暴减转为**企稳**」而 OI 仍在减；A1/B1 写「钱没有在撤」
   * 而它的健康档恰恰接受 OI 下降。三处都不会报错，只是在骗读的人。
   *
   * 根因是文案在**断言**状态。带上这个字段之后文案改成从它**选词**
   * （i18n 的 ICU select），形容词就不可能跟数字矛盾——因为它就是数字选出来的。
   * 新增场景时，只要文案里出现任何描述 OI 的定语，都该走这个字段而不是写死。
   */
  oiState: OiState;
}

/**
 * 每个场景，引擎**实际可能产出**的 OI 状态。
 *
 * 这张表是文案的契约：卡片文案里任何描述 OI 的定语，都必须对这里的每一项
 * 都成立；做不到就得走 ICU select 从 oiState 选词，不能写死。
 *
 * 有测试盯着（screener/scenario-copy.test.ts）——同时向两边验：改判定逻辑
 * 放宽了某个场景的 OI 档位而没更新这张表会被抓到，文案在跨方向的场景里
 * 写死 OI 定语也会被抓到。这一类 bug 上线过三处，全都不报错，只是在骗读的人。
 *
 * 各项的依据直接对应下面各个 detect 函数里的门槛：
 *   A1/B1  回调段排除 plunge，其余四档都收（trend_best 收 up/flat/surge，healthy 收 down）
 *   A2     oiUp → strongest；oiDown 且做多侧 → medium（真底背离）
 *   B2     只收 oiUp（规格的不对称：做空侧不取 OI 减）
 *   A3/B3  力度扳机第 ③ 条硬性要求 up/surge
 *   A4/B4  前置闸门只排除 plunge
 *   陷阱   入口条件就是 oiPct ≥ OI_SURGE_PCT
 */
export const OI_STATES_BY_KIND: Record<ScenarioKind, OiState[]> = {
  a1_healthy_pullback: ["surge", "up", "flat", "down"],
  b1_healthy_bounce: ["surge", "up", "flat", "down"],
  a2_accum_bottom_div: ["surge", "up", "down", "plunge"],
  b2_distrib_top_div: ["surge", "up"],
  a3_e1_absorb: ["surge", "up"],
  b3_e5_distrib: ["surge", "up"],
  a4_e4_flush: ["surge", "up", "flat", "down"],
  b4_e8_cover_stall: ["surge", "up", "flat", "down"],
  trap_false_top_div: ["surge"],
  trap_false_bottom_div: ["surge"],
};

/**
 * 力度扳机的斜率倍数下限（A3/B3 的第 ② 条）。
 *
 * 规格给的是「1.5–2 倍」一个区间。取下界 1.5：这套系统眼下的问题一直是
 * 门槛叠太紧导致几乎不出卡（六场景时代实测每天只出 8–26 个，改了选币口径
 * 之后直接归零），在一个区间里挑上界只会让它更沉默。真出卡太多再收紧。
 */
export const SLOPE_RATIO_MIN = 1.5;

/** 短时间收复整段跌幅的比例下限（A3/B3 第 ② 条的另一条路）。 */
export const RECLAIM_PCT_MIN = 30;

/** 判定回看窗口：往回找 sweep 的最大根数。48 根 = 24 小时。 */
export const SCENARIO_LOOKBACK = 48;

interface Ctx {
  bars: CoinGlassPriceBar[];
  h: number[];
  l: number[];
  c: number[];
  oi: number[];
  cvd: number[];
  taker: CoinGlassTakerBar[];
  last: number;
}

/**
 * 一段区间 (from, to] 上三个变量各自的读数。
 *
 * `to` 传 ctx.last 时，OI 那一项读的是**当前周期的实时快照**而不是收盘值
 * （实测见 coinglass/open-interest.ts 顶部）。也就是说 oiPct/oiState 会随
 * 扫描落在这根 K 线的第几分钟而漂，同一根 K 线上有可能 flat ↔ up 来回跳。
 * 这是有意接受的：OI 是存量不是流量，当前快照就是此刻最真实的持仓水平。
 */
function leg(ctx: Ctx, from: number, to: number) {
  const pricePct = pctChange(ctx.c, from, to);
  const oiPct = pctChange(ctx.oi, from, to);
  const cvdPct = cvdNetPct(ctx.taker, from, to);
  const oi = oiState(ctx.oi, from, to);
  if (pricePct === null || oiPct === null || cvdPct === null || oi === null) return null;
  return { pricePct, oiPct, cvdPct, oi };
}

/** 这条序列最后两个摆动点之间有没有创新极值。取不到摆动点返回 null。 */
function newExtreme(values: number[], kind: "high" | "low"): boolean | null {
  const pv = lastTwoPivots(values, kind);
  if (!pv) return null;
  const a = values[pv.prev];
  const b = values[pv.curr];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return kind === "high" ? b > a : b < a;
}

function mk(
  kind: ScenarioKind,
  direction: ScenarioDirection,
  strength: ScenarioStrength,
  trap: boolean,
  triggeredAt: number,
  invalidationPrice: number,
  breach: "above" | "below",
  structureLevel: number,
  cvdPct: number,
  oiPct: number,
  oi: OiState
): Scenario | null {
  if (!Number.isFinite(invalidationPrice) || invalidationPrice <= 0) return null;
  if (!Number.isFinite(triggeredAt)) return null;
  return {
    kind,
    direction,
    trap,
    strength,
    triggeredAt,
    invalidation: { price: invalidationPrice, breach },
    structureLevel,
    cvdPct,
    oiPct,
    oiState: oi,
  };
}

/* ────────────────────────────── 陷阱 ──────────────────────────────
 * 独立判定，**优先级高于所有场景**。识别关键是出现「剧烈 / 暴增」这类
 * 极端量级：任一场景判定过程中检出这两种组合，直接覆盖原判定。
 *
 * 假顶背离 = 新高/高位盘整 + CVD 剧烈走弱 + OI 暴增 → 禁止做空，顺势做多
 * 假底背离 = 新低/低位盘整 + CVD 剧烈走强 + OI 暴增 → 禁止做多，顺势做空
 *
 * 方向是**反直觉**的，这正是它叫「假背离」的原因：看着像背离该反手，
 * 实际那批逆势追进来的新仓（OI 暴增）才是待收割的一方，该顺着原方向走。
 */
function detectTrap(ctx: Ctx): Scenario | null {
  for (const side of ["high", "low"] as const) {
    const values = side === "high" ? ctx.h : ctx.l;
    const pv = lastTwoPivots(values, side);
    if (!pv) continue;
    const st = leg(ctx, pv.prev, ctx.last);
    if (!st) continue;

    // 「新高/高位盘整」= 没有往反方向走掉。跌回去就不是这个局面了。
    const holding = side === "high" ? st.pricePct > -CVD_ALIGN_PCT : st.pricePct < CVD_ALIGN_PCT;
    if (!holding) continue;
    if (st.oiPct < OI_SURGE_PCT) continue;

    const violent = side === "high" ? st.cvdPct <= -CVD_EXTREME_PCT : st.cvdPct >= CVD_EXTREME_PCT;
    if (!violent) continue;

    const level = values[pv.curr];
    return mk(
      side === "high" ? "trap_false_top_div" : "trap_false_bottom_div",
      side === "high" ? "long" : "short",
      "strongest",
      true,
      ctx.bars[pv.curr].time,
      level,
      side === "high" ? "below" : "above",
      level,
      st.cvdPct,
      st.oiPct,
      st.oi
    );
  }
  return null;
}

/* ────────────────── A1 / B1 健康趋势回调 · 反弹 ──────────────────
 * 前置（酝酿期）：价格连续创新极值且高低点同向推进、CVD 同步创新极值、
 * OI 每一波都在增加。三条都要，缺一条就不是「健康趋势」，后面的回调
 * 也就无从谈起。
 *
 * 触发看的是回调段里 CVD 与 OI 的配合：
 *   CVD 跌得比价格多(E1) + OI 增或平 → 最佳回调 ⭐
 *   CVD 与价格同步小幅回落 + OI 小幅减 → 正常回调 ✅
 *   CVD 急速创新低跌破上涨起点 + OI 增 → 新空头介入 ⛔
 *   OI 快速大幅减 → 趋势衰竭 ⛔
 *   跌破 swing low → 趋势失效 ⛔ 作废
 */
function detectHealthyPullback(ctx: Ctx, dir: "long" | "short"): Scenario | null {
  const up = dir === "long";
  const trendSide = up ? "high" : "low";
  const guardSide = up ? "low" : "high";
  const trendVals = up ? ctx.h : ctx.l;
  const guardVals = up ? ctx.l : ctx.h;

  // ── 前置状态
  if (newExtreme(trendVals, trendSide) !== true) return null;
  // 高点抬高的同时低点也要抬高（做空侧镜像）
  if (newExtreme(guardVals, guardSide) === true) return null;
  if (newExtreme(ctx.cvd, trendSide) !== true) return null;

  const trendPv = lastTwoPivots(trendVals, trendSide);
  const guardPv = lastTwoPivots(guardVals, guardSide);
  if (!trendPv || !guardPv) return null;

  // 推进段的 OI 必须在增加，否则这波推进本身就没有新钱
  const push = leg(ctx, trendPv.prev, trendPv.curr);
  if (!push || push.oiPct <= 0) return null;

  // ── 硬门槛：结构没破。破了直接作废，不论其他变量多好。
  const guardLevel = guardVals[guardPv.curr];
  if (!Number.isFinite(guardLevel)) return null;
  for (let i = guardPv.curr + 1; i <= ctx.last; i++) {
    const v = up ? ctx.l[i] : ctx.h[i];
    if (Number.isFinite(v) && (up ? v < guardLevel : v > guardLevel)) return null;
  }

  // ── 回调段：从最新那个推进极值到现在
  const back = leg(ctx, trendPv.curr, ctx.last);
  if (!back) return null;
  // 还在顺势推进、没有回调，就不是这个场景
  if (up ? back.pricePct >= 0 : back.pricePct <= 0) return null;

  // OI 快速大幅减 = 趋势衰竭，排除
  if (back.oi === "plunge") return null;

  // 顺方向的 CVD：做多侧回调期望 CVD 为负，做空侧反弹期望 CVD 为正
  const signedCvd = up ? back.cvdPct : -back.cvdPct;

  // CVD 急速创新极值并跌破推进起点 + OI 增 = 新的反向力量介入，排除
  if (signedCvd <= -CVD_EXTREME_PCT && back.oiPct > 0) return null;

  let strength: ScenarioStrength;
  if (
    signedCvd <= -CVD_ALIGN_PCT &&
    (back.oi === "up" || back.oi === "flat" || back.oi === "surge")
  ) {
    strength = "trend_best"; // CVD 跌得比价格多 + OI 增或平
  } else if (back.oi === "down") {
    strength = "healthy"; // 同步小幅回落 + 小幅减
  } else {
    return null;
  }

  return mk(
    up ? "a1_healthy_pullback" : "b1_healthy_bounce",
    dir,
    strength,
    false,
    ctx.bars[trendPv.curr].time,
    guardLevel,
    up ? "below" : "above",
    guardLevel,
    back.cvdPct,
    back.oiPct,
    back.oi
  );
}

/* ────────────── A2 / B2 增仓型底背离 · 顶背离 ──────────────
 * 价格必要条件（定义，不可省）：创出新极值 → 扫掉明确的 SSL/BSL →
 * **收回来**。仅实体跌破未收回不算 sweep，场景不成立。
 *
 * CVD 判定法：价格创新低时，CVD 有没有跌破**它自己**前一个 swing low。
 * 没跌破 → 背离成立。这是全套规格里最容易实现错的一条：拿 CVD 的绝对
 * 涨跌去判，而不是拿它自己的 swing 去判。
 *
 * 不对称：做多侧 OI 减的「真底背离」可用（🟠 中强）；做空侧因上行漂移与
 * 资金费率成本，**只取 OI 增的增仓型**。这不是笔误。
 */
function detectSweepDivergence(ctx: Ctx, dir: "long" | "short"): Scenario | null {
  const up = dir === "long";
  const side = up ? "low" : "high";

  const sweep: Sweep | null = findSweep(ctx.bars, side, SCENARIO_LOOKBACK);
  if (!sweep) return null;

  // CVD 有没有跟着创新极值。跟了 = 同步，不是背离。
  const cvdBroke = newExtreme(ctx.cvd, side);
  if (cvdBroke !== false) return null;

  const st = leg(ctx, Math.max(0, sweep.at - PIVOT_N), ctx.last);
  if (!st) return null;

  const oiUp = st.oi === "up" || st.oi === "surge";
  const oiDown = st.oi === "down" || st.oi === "plunge";

  let strength: ScenarioStrength;
  if (oiUp) strength = "strongest";
  else if (oiDown && up) strength = "medium"; // 真底背离，只有做多侧取
  else return null;

  // 失效位：sweep 那一根的极值。价格越过它 = 这次扫盘没站住。
  const wick = up ? ctx.l[sweep.at] : ctx.h[sweep.at];
  return mk(
    up ? "a2_accum_bottom_div" : "b2_distrib_top_div",
    dir,
    strength,
    false,
    ctx.bars[sweep.at].time,
    wick,
    up ? "below" : "above",
    sweep.level,
    st.cvdPct,
    st.oiPct,
    st.oi
  );
}

/* ─────────────── A3 / B3 E1吸筹 · E5派发（两层结构）───────────────
 * 第一层 E1/E5 定位（**不触发**）：
 *   E1 = CVD 创新低 + 价格未创新低（CVD 跌得比价格多）；OI 增才成立，
 *        OI 减是 E2，出局，等 OI 由减转增才变回 E1。
 *   E5 = 镜像。
 *   E1/E5 是持续状态，只作定位与否决，不作入场扳机。
 *
 * 第二层 力度扳机（四条同时成立才触发）：
 *   ① CVD 转向：swing low 高于前一个 swing low（红变青不算）
 *   ② 力度达标：反转斜率 ÷ 前面下跌段平均斜率 > 1.5–2 倍，
 *      或短时间收复整段跌幅 > 30%
 *   ③ OI 同步增加（力度大 + OI 减 = 假的，是回补）
 *   ④ 有明确失效位：本波最低点
 */
function detectAbsorption(ctx: Ctx, dir: "long" | "short"): Scenario | null {
  const up = dir === "long";
  const cvdSide = up ? "low" : "high";
  const priceSide = up ? "low" : "high";
  const priceVals = up ? ctx.l : ctx.h;

  // ── 第一层：E1 / E5 定位
  // CVD 创新极值，而价格没有——这正是「CVD 跌得比价格多」的结构表达。
  if (newExtreme(ctx.cvd, cvdSide) !== true) return null;
  if (newExtreme(priceVals, priceSide) !== false) return null;

  // CVD 需要三个摆动点：L1→L2 是 E1 那段，L2→L3 是转向。
  const cvdPivots = findPivots(ctx.cvd, PIVOT_N, cvdSide);
  if (cvdPivots.length < 3) return null;
  const [i1, i2, i3] = cvdPivots.slice(-3);

  // ① CVD 转向：最新的摆动点比上一个更靠顺方向
  const turned = up ? ctx.cvd[i3] > ctx.cvd[i2] : ctx.cvd[i3] < ctx.cvd[i2];
  if (!turned) return null;

  // ② 力度达标：反转斜率 ÷ 前段斜率，或短时间收复整段跌幅
  const declineSpan = i2 - i1;
  const reboundSpan = ctx.last - i2;
  if (declineSpan <= 0 || reboundSpan <= 0) return null;
  const declineMove = Math.abs(ctx.cvd[i2] - ctx.cvd[i1]);
  if (!Number.isFinite(declineMove) || declineMove <= 0) return null;
  const reboundMove = Math.abs(ctx.cvd[ctx.last] - ctx.cvd[i2]);
  const slopeRatio = reboundMove / reboundSpan / (declineMove / declineSpan);
  const reclaimed = (reboundMove / declineMove) * 100;
  if (slopeRatio < SLOPE_RATIO_MIN && reclaimed < RECLAIM_PCT_MIN) return null;

  // ③ OI 同步增加。力度大 + OI 减 = 回补，不是吸筹。
  const st = leg(ctx, i2, ctx.last);
  if (!st) return null;
  if (st.oi !== "up" && st.oi !== "surge") return null;

  // ④ 失效位：本波最低点（做空侧为最高点）
  let extreme = up ? Infinity : -Infinity;
  for (let k = i2; k <= ctx.last; k++) {
    const v = priceVals[k];
    if (!Number.isFinite(v)) continue;
    if (up ? v < extreme : v > extreme) extreme = v;
  }

  return mk(
    up ? "a3_e1_absorb" : "b3_e5_distrib",
    dir,
    "strongest",
    false,
    ctx.bars[i2].time,
    extreme,
    up ? "below" : "above",
    extreme,
    st.cvdPct,
    st.oiPct,
    st.oi
  );
}

/* ────────── A4 / B4 E4恐慌清算 · E8回补失速（OI 企稳）──────────
 * E4 = 价格创新低（跌得比 CVD 多，真空式下跌）+ CVD 未创新低 + OI 减少。
 *
 * 前置闸门（不可跳过）：
 *   OI 还在暴减 → 清算未结束，不动
 *   OI 缩量至走平 → 清算尾声
 *   OI 转为增加 → 新资金进场确认，最佳
 *
 * E1 与 E4 的分辨不看形态：E1 是 CVD 跌得比价格多且 OI 增，可以 sweep
 * 直接触发；E4 是价格跌得比 CVD 多且 OI 减，**必须先等 OI 企稳**。
 */
function detectFlush(ctx: Ctx, dir: "long" | "short"): Scenario | null {
  const up = dir === "long";
  const side = up ? "low" : "high";
  const priceVals = up ? ctx.l : ctx.h;

  // E4/E8：价格创新极值，CVD 没有
  if (newExtreme(priceVals, side) !== true) return null;
  if (newExtreme(ctx.cvd, side) !== false) return null;

  const pv = lastTwoPivots(priceVals, side);
  if (!pv) return null;

  // 清算段：推向新极值的那一段，OI 必须是在减少的
  const flush = leg(ctx, pv.prev, pv.curr);
  if (!flush || flush.oiPct >= 0) return null;

  // 前置闸门：极值之后 OI 有没有企稳
  const after = leg(ctx, pv.curr, ctx.last);
  if (!after) return null;
  if (after.oi === "plunge") return null; // 还在暴减 = 清算未结束

  // 价格企稳 + CVD 止跌回升：顺方向的 CVD 要转正
  const signedCvd = up ? after.cvdPct : -after.cvdPct;
  if (signedCvd <= 0) return null;

  const strength: ScenarioStrength =
    after.oi === "up" || after.oi === "surge" ? "strongest" : "healthy";

  const extreme = priceVals[pv.curr];
  return mk(
    up ? "a4_e4_flush" : "b4_e8_cover_stall",
    dir,
    strength,
    false,
    ctx.bars[pv.curr].time,
    extreme,
    up ? "below" : "above",
    extreme,
    after.cvdPct,
    after.oiPct,
    after.oi
  );
}

/**
 * 主判定。陷阱最优先，其余按强度从高到低——同时命中多个时报强度最高的。
 */
export function classifyScenario(
  priceBars: CoinGlassPriceBar[],
  oiBars: CoinGlassOiBar[],
  taker: CoinGlassTakerBar[]
): Scenario | null {
  const n = priceBars.length;
  if (n < PIVOT_N * 2 + 2 || oiBars.length !== n || taker.length !== n) return null;

  const cvd = cvdLine(taker);
  if (!cvd) return null;

  const ctx: Ctx = {
    bars: priceBars,
    h: highs(priceBars),
    l: lows(priceBars),
    c: closes(priceBars),
    oi: oiCloses(oiBars),
    cvd,
    taker,
    last: n - 1,
  };

  const trap = detectTrap(ctx);
  if (trap) return trap;

  const found: Scenario[] = [];
  for (const f of [
    () => detectSweepDivergence(ctx, "long"),
    () => detectSweepDivergence(ctx, "short"),
    () => detectAbsorption(ctx, "long"),
    () => detectAbsorption(ctx, "short"),
    () => detectHealthyPullback(ctx, "long"),
    () => detectHealthyPullback(ctx, "short"),
    () => detectFlush(ctx, "long"),
    () => detectFlush(ctx, "short"),
  ]) {
    const s = f();
    if (s) found.push(s);
  }
  if (found.length === 0) return null;

  const rank: Record<ScenarioStrength, number> = {
    strongest: 0,
    trend_best: 1,
    medium: 2,
    healthy: 3,
  };
  found.sort((a, b) => rank[a.strength] - rank[b.strength]);
  return found[0];
}

export type { OiState };
