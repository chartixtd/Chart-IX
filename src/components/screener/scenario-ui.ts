import type { ScenarioKind, ScenarioDirection } from "@/lib/screener/factors/scenario";

/**
 * 六场景在前端共用的展示元数据：色调、方向配色、判定句 i18n key。
 * AlertCard / ScannerTable / 扫描器页面的速查说明三处都要用同一套映射，
 * 抽到这里是为了不让三处各自维护一份、改一处漏两处。
 */

/** 场景卡片的四色基调——不是六色，是六个 kind 归并到四档。 */
export type ScenarioTone = "trend" | "manage" | "divTrue" | "divFalse";

export const SCENARIO_KINDS: ScenarioKind[] = [
  "healthy_trend",
  "inventory_flush",
  "true_top_div",
  "true_bottom_div",
  "false_top_div",
  "false_bottom_div",
];

/** 仅这两个 kind 是陷阱——与 factors/scenario.ts classifyCell 里 trap 的赋值一一对应。 */
export const TRAP_KINDS = new Set<ScenarioKind>(["false_top_div", "false_bottom_div"]);

export function scenarioTone(kind: ScenarioKind): ScenarioTone {
  switch (kind) {
    case "healthy_trend":
      return "trend";
    case "inventory_flush":
      return "manage";
    case "true_top_div":
    case "true_bottom_div":
      return "divTrue";
    case "false_top_div":
    case "false_bottom_div":
      return "divFalse";
  }
}

/**
 * 色调 → Tailwind 既有 token。假背离的紫色是唯一允许引入的新颜色（用
 * Tailwind 内置 purple-400/500 一族），其余三档全部复用项目已有的
 * success/info/gold。
 */
export const TONE_CLASSES: Record<
  ScenarioTone,
  { border: string; text: string; badgeBg: string; fill: string }
> = {
  trend: {
    border: "border-l-text-primary/50",
    text: "text-text-primary",
    badgeBg: "bg-text-primary/10",
    fill: "bg-success",
  },
  manage: {
    border: "border-l-info",
    text: "text-info",
    badgeBg: "bg-info/15",
    fill: "bg-info",
  },
  divTrue: {
    border: "border-l-gold",
    text: "text-gold",
    badgeBg: "bg-gold/15",
    fill: "bg-gold",
  },
  divFalse: {
    border: "border-l-purple-400",
    text: "text-purple-400",
    badgeBg: "bg-purple-400/15",
    fill: "bg-purple-400",
  },
};

/**
 * 方向配色：多空用项目已有的 success/danger（跟表格既有的 LONG/SHORT
 * pill 同色），manage 的顶部徽章刻意用灰色而不是 info 蓝——manage 不是
 * 一个可下单方向，用灰色跟"这不是一个交易方向"的语义对上；但操作指令条
 * （actionBg/actionText）用 info 蓝，跟场景基调的"存量清算=蓝"呼应，
 * 两处刻意不同色是为了把"徽章=这是不是能下单的方向"和"指令条=现在该
 * 做什么"这两件事在视觉上分开。
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

/**
 * 判定句 i18n key：healthy_trend / inventory_flush 这两个 kind 高点侧/
 * 低点侧共用同一个 kind 名，判定句里"创新高"还是"创新低"要看 side 才能
 * 确定；其余四个 kind 的名字本身已经带了 top/bottom，不需要再拆分。
 */
export function readingKey(kind: ScenarioKind, side: "high" | "low"): string {
  if (kind === "healthy_trend" || kind === "inventory_flush") return `${kind}_${side}`;
  return kind;
}
