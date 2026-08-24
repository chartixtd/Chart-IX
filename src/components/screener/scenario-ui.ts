import type { ScenarioKind, ScenarioDirection } from "@/lib/screener/factors/scenario";

/**
 * 六场景在前端共用的展示元数据：色调、方向配色、判定句 i18n key。
 * AlertCard / ScannerTable / 扫描器页面的速查说明三处都要用同一套映射，
 * 抽到这里是为了不让三处各自维护一份、改一处漏两处。
 */

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

/**
 * 六场景各自的配色，一个 kind 一种颜色。
 *
 * 曾经是「六个 kind 归并到四档」——真顶/真底共用金色、假顶/假底共用紫色。
 * 那样做是为了让「金=可以反手 / 紫=陷阱」这条最要紧的区分更醒目，但代价是
 * 六个场景在卡片上只能看出四种，读者认不出具体是哪一个。
 *
 * 现在一人一色，但**同族的两个用相邻色相**，两件事就都拿到了：
 *   · 真背离家族走暖色（金 / 橙）——一眼是「可以反手」那一类
 *   · 假背离家族走紫色系（紫 / 品红）——一眼是「陷阱」那一类
 *   · 家族内部再靠色相差异分出顶 / 底
 *
 * **绿与红是禁区**：它们已经被方向占用（顶部 pill 与操作指令条）。基调
 * 再用绿/红，一张卡上会出现两个含义不同的绿，读者分不清哪个代表什么。
 * 所以六色全部避开 success/danger，落在青→蓝→金→橙→紫→品红这一圈上。
 *
 * borderTint 必须显式写死，不能用 badgeBg 拼字符串——**Tailwind 只生成
 * 它在源码里原样看到的 class**，动态拼出来的名字一条规则都不会生成
 * （这个坑在 Button 的 bg-success/12 上踩过一次，那两个变体的底色一直是
 * 透明的，而且没人发现）。
 */
export const TONE_CLASSES: Record<
  ScenarioKind,
  { border: string; text: string; badgeBg: string; borderTint: string; fill: string }
> = {
  // 健康趋势：青。最常见的场景，此前是「无色」（白边框+白字），
  // 导致大多数卡片看上去没有基调。
  healthy_trend: {
    border: "border-l-accent-teal",
    text: "text-accent-teal",
    badgeBg: "bg-accent-teal/15",
    borderTint: "border-accent-teal/20",
    fill: "bg-accent-teal",
  },
  // 存量清算：蓝。与操作指令条的 info 蓝呼应——两处都在说「该管理仓位了」。
  inventory_flush: {
    border: "border-l-info",
    text: "text-info",
    badgeBg: "bg-info/15",
    borderTint: "border-info/20",
    fill: "bg-info",
  },
  // 真顶背离：金。项目主题色，给了最值钱的两个信号之一。
  true_top_div: {
    border: "border-l-gold",
    text: "text-gold",
    badgeBg: "bg-gold/15",
    borderTint: "border-gold/20",
    fill: "bg-gold",
  },
  // 真底背离：橙。与金同属暖色（同一家族），但更鲜亮，分得开顶与底。
  true_bottom_div: {
    border: "border-l-accent-orange",
    text: "text-accent-orange",
    badgeBg: "bg-accent-orange/15",
    borderTint: "border-accent-orange/20",
    fill: "bg-accent-orange",
  },
  // 假顶背离：紫。陷阱家族。
  false_top_div: {
    border: "border-l-accent-violet",
    text: "text-accent-violet",
    badgeBg: "bg-accent-violet/15",
    borderTint: "border-accent-violet/20",
    fill: "bg-accent-violet",
  },
  // 假底背离：品红。与紫同族，色相再推一档。
  false_bottom_div: {
    border: "border-l-accent-magenta",
    text: "text-accent-magenta",
    badgeBg: "bg-accent-magenta/15",
    borderTint: "border-accent-magenta/20",
    fill: "bg-accent-magenta",
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
