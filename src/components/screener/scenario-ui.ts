import type { ScenarioKind, ScenarioDirection, ScenarioStrength } from "@/lib/screener/factors/scenario";
import type { CardTrigger } from "@/lib/screener/cards";

/**
 * 八场景 + 陷阱在前端共用的展示元数据。AlertCard / ScannerTable / 扫描器
 * 页面的速查说明三处都要用同一套映射，抽到这里是为了不让三处各自维护一份。
 */

/** 做多四场景在前、做空四场景在后，陷阱单列。顺序即速查表的显示顺序。 */
export const SCENARIO_KINDS: ScenarioKind[] = [
  "a1_healthy_pullback",
  "a2_accum_bottom_div",
  "a3_e1_absorb",
  "a4_e4_flush",
  "b1_healthy_bounce",
  "b2_distrib_top_div",
  "b3_e5_distrib",
  "b4_e8_cover_stall",
  "trap_false_top_div",
  "trap_false_bottom_div",
];

/** 陷阱两格——与 factors/scenario.ts 里 trap 的赋值一一对应。 */
export const TRAP_KINDS = new Set<ScenarioKind>(["trap_false_top_div", "trap_false_bottom_div"]);

export interface Tone {
  border: string;
  text: string;
  badgeBg: string;
  borderTint: string;
  fill: string;
}

const tone = (name: string): Tone => ({
  border: `border-l-${name}`,
  text: `text-${name}`,
  badgeBg: `bg-${name}/15`,
  borderTint: `border-${name}/20`,
  fill: `bg-${name}`,
});

/*
 * 下面这十条**必须把类名整串写出来**，不能用上面那个 tone() 拼。
 *
 * Tailwind 只生成它在源码里原样看到的类名，拼出来的名字一条 CSS 规则都不会
 * 生成——而且是静默的，页面照常渲染，只是颜色全丢。这个坑在 Button 的
 * bg-success/12 上踩过一次，那两个变体的底色一直是透明的，没人发现。
 *
 * tone() 留着只是为了标注每种场景用哪个色名，实际值全部写死。
 */
void tone;

export const TONE_CLASSES: Record<ScenarioKind, Tone> = {
  // ── 做多四场景
  // A1 健康趋势回调：青。最常见的顺势场景，沿用旧引擎 healthy_trend 的颜色。
  a1_healthy_pullback: {
    border: "border-l-accent-teal",
    text: "text-accent-teal",
    badgeBg: "bg-accent-teal/15",
    borderTint: "border-accent-teal/20",
    fill: "bg-accent-teal",
  },
  // A2 增仓型底背离：金。规格里的 🔴 最强档，给项目主题色。
  a2_accum_bottom_div: {
    border: "border-l-gold",
    text: "text-gold",
    badgeBg: "bg-gold/15",
    borderTint: "border-gold/20",
    fill: "bg-gold",
  },
  // A3 E1 吸筹：蓝。
  a3_e1_absorb: {
    border: "border-l-info",
    text: "text-info",
    badgeBg: "bg-info/15",
    borderTint: "border-info/20",
    fill: "bg-info",
  },
  // A4 E4 恐慌清算：青蓝。
  a4_e4_flush: {
    border: "border-l-accent-cyan",
    text: "text-accent-cyan",
    badgeBg: "bg-accent-cyan/15",
    borderTint: "border-accent-cyan/20",
    fill: "bg-accent-cyan",
  },
  // ── 做空四场景
  // B1 健康跌势反弹：橙。与 A1 的青成对，一眼分得出做多侧还是做空侧的顺势。
  b1_healthy_bounce: {
    border: "border-l-accent-orange",
    text: "text-accent-orange",
    badgeBg: "bg-accent-orange/15",
    borderTint: "border-accent-orange/20",
    fill: "bg-accent-orange",
  },
  // B2 增仓型顶背离：玫红。与 A2 的金成对，同属最强档。
  b2_distrib_top_div: {
    border: "border-l-accent-rose",
    text: "text-accent-rose",
    badgeBg: "bg-accent-rose/15",
    borderTint: "border-accent-rose/20",
    fill: "bg-accent-rose",
  },
  // B3 E5 派发：靛蓝。与 A3 的蓝成对。
  b3_e5_distrib: {
    border: "border-l-accent-indigo",
    text: "text-accent-indigo",
    badgeBg: "bg-accent-indigo/15",
    borderTint: "border-accent-indigo/20",
    fill: "bg-accent-indigo",
  },
  // B4 E8 回补失速：品红。与 A4 的青蓝成对。
  b4_e8_cover_stall: {
    border: "border-l-accent-magenta",
    text: "text-accent-magenta",
    badgeBg: "bg-accent-magenta/15",
    borderTint: "border-accent-magenta/20",
    fill: "bg-accent-magenta",
  },
  // ── 陷阱
  // 两格**共用紫色**，靠 ⚠ 图标与 LONG/SHORT pill 区分。这是全表唯一一处
  // 共色：色环已经排不下第十个能被可靠分辨的色相（相邻 20° 以内在深色底上
  // 分不开），而这两格给出的指令本来就是同一句「禁止反手，顺着原方向走」，
  // 差别只在方向——方向正是 pill 已经在编码的东西。
  trap_false_top_div: {
    border: "border-l-accent-violet",
    text: "text-accent-violet",
    badgeBg: "bg-accent-violet/15",
    borderTint: "border-accent-violet/20",
    fill: "bg-accent-violet",
  },
  trap_false_bottom_div: {
    border: "border-l-accent-violet",
    text: "text-accent-violet",
    badgeBg: "bg-accent-violet/15",
    borderTint: "border-accent-violet/20",
    fill: "bg-accent-violet",
  },
};

/**
 * 点火卡的色调。**刻意不并进 TONE_CLASSES**——那张表的键是 ScenarioKind，
 * 塞一个假的 kind 进去，编译器就再也帮不上忙了（八场景的穷尽性检查会失效，
 * 以后新增场景漏配颜色不会报错）。点火是另一个类别，就让它是另一个常量。
 */
export const IGNITION_TONE: Tone = {
  border: "border-l-accent-ignite",
  text: "text-accent-ignite",
  badgeBg: "bg-accent-ignite/15",
  borderTint: "border-accent-ignite/20",
  fill: "bg-accent-ignite",
};

/** 一张卡该用哪套配色，两种触发源统一从这里取。 */
export function toneFor(trigger: CardTrigger): Tone {
  return trigger.type === "scenario" ? TONE_CLASSES[trigger.scenario.kind] : IGNITION_TONE;
}

/**
 * 方向配色：多空用项目已有的 success/danger（跟表格既有的 LONG/SHORT
 * pill 同色），manage 的顶部徽章刻意用灰色而不是 info 蓝——manage 不是
 * 一个可下单方向，用灰色跟「这不是一个交易方向」的语义对上。
 */
export const DIRECTION_CLASSES: Record<
  ScenarioDirection,
  { pillBg: string; pillText: string; actionBg: string; actionText: string }
> = {
  long: {
    pillBg: "bg-success/15",
    pillText: "text-success",
    actionBg: "bg-success/15",
    actionText: "text-success",
  },
  short: {
    pillBg: "bg-danger/15",
    pillText: "text-danger",
    actionBg: "bg-danger/15",
    actionText: "text-danger",
  },
  manage: {
    pillBg: "bg-text-secondary/15",
    pillText: "text-text-secondary",
    actionBg: "bg-info/15",
    actionText: "text-info",
  },
};

/** 强度徽章。规格的分级汇总表，卡片右上角用它标「这信号有多强」。 */
export const STRENGTH_CLASSES: Record<ScenarioStrength, { bg: string; text: string }> = {
  strongest: { bg: "bg-gold/15", text: "text-gold" },
  trend_best: { bg: "bg-accent-teal/15", text: "text-accent-teal" },
  medium: { bg: "bg-accent-orange/15", text: "text-accent-orange" },
  healthy: { bg: "bg-text-secondary/15", text: "text-text-secondary" },
};
