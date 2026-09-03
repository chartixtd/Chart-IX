import type { ScenarioKind } from "./factors/scenario";

/**
 * 警报卡的文案表。Telegram 与 Web Push 两个通道共用。
 *
 * 共用不是为了省几行——两个通道说的是**同一个事件**，文案各写一份就会分叉：
 * Telegram 说「反手做空」而系统推送说「考虑做空」，读的人无从判断哪个是准的。
 * 场景名与操作文案原样取自三变量判读规格，改这里之前先去改那份规格。
 *
 * 只有 zh / en 两语。推送订阅的 locale 有 ms-MY，它会落到 en（见 pickAlertLang）。
 * 这跟 Telegram 侧的 TelegramMessageLang 是同一个取值集合，但不复用那个类型——
 * telegram-push.ts 会拉进 Supabase 依赖，而这个模块必须保持纯净：
 * lib/push/messages.ts 要在 cron 路由里 import 它。
 */
export type AlertCopyLang = "en" | "zh";

/** 场景名，跟 brief 里六场景速查表用的中文名一一对应，英文是直译。 */
/** 场景名。跟规格里 A1–A4 / B1–B4 的命名一一对应，英文是直译。 */
export const SCENARIO_LABELS: Record<AlertCopyLang, Record<ScenarioKind, string>> = {
  zh: {
    a1_healthy_pullback: "健康趋势回调",
    a2_accum_bottom_div: "增仓型底背离",
    a3_e1_absorb: "E1吸筹",
    a4_e4_flush: "恐慌清算企稳",
    b1_healthy_bounce: "健康跌势反弹",
    b2_distrib_top_div: "增仓型顶背离",
    b3_e5_distrib: "E5派发",
    b4_e8_cover_stall: "回补失速",
    trap_false_top_div: "假顶背离",
    trap_false_bottom_div: "假底背离",
  },
  en: {
    a1_healthy_pullback: "Healthy Pullback",
    a2_accum_bottom_div: "Accumulation Bottom Divergence",
    a3_e1_absorb: "E1 Absorption",
    a4_e4_flush: "Flush Stabilised",
    b1_healthy_bounce: "Healthy Bounce",
    b2_distrib_top_div: "Distribution Top Divergence",
    b3_e5_distrib: "E5 Distribution",
    b4_e8_cover_stall: "Short-Cover Stall",
    trap_false_top_div: "False Top Divergence",
    trap_false_bottom_div: "False Bottom Divergence",
  },
};

/** 操作文案，原样取自规格的触发组合表——不重新措辞，避免文案与判定脱节。 */
export const SCENARIO_ACTIONS: Record<AlertCopyLang, Record<ScenarioKind, string>> = {
  zh: {
    a1_healthy_pullback: "顺势做多，回调进场",
    a2_accum_bottom_div: "扫底收回，反手做多",
    a3_e1_absorb: "吸筹力度到位，做多",
    a4_e4_flush: "清算结束，做多",
    b1_healthy_bounce: "顺势做空，反弹进场",
    b2_distrib_top_div: "扫顶收回，反手做空",
    b3_e5_distrib: "派发力度到位，做空",
    b4_e8_cover_stall: "回补结束，做空",
    trap_false_top_div: "禁止做空，顺势做多",
    trap_false_bottom_div: "禁止做多，顺势做空",
  },
  en: {
    a1_healthy_pullback: "Follow the trend, enter on the pullback",
    a2_accum_bottom_div: "Lows swept and reclaimed, go long",
    a3_e1_absorb: "Absorption confirmed, go long",
    a4_e4_flush: "Liquidation over, go long",
    b1_healthy_bounce: "Follow the trend, enter on the bounce",
    b2_distrib_top_div: "Highs swept and reclaimed, go short",
    b3_e5_distrib: "Distribution confirmed, go short",
    b4_e8_cover_stall: "Short covering over, go short",
    trap_false_top_div: "Do not short — follow trend, go long",
    trap_false_bottom_div: "Do not long — follow trend, go short",
  },
};

/** 点火卡的名称与操作文案。两种触发源共用一条消息格式，这里只是把
 *  「场景名 · 操作」那两格换成点火自己的说法。 */
export const IGNITION_LABELS: Record<AlertCopyLang, { up: string; down: string; action: string }> = {
  zh: { up: "向上点火", down: "向下点火", action: "刚突破区间，顺势跟" },
  en: { up: "Ignition Up", down: "Ignition Down", action: "Just broke range — follow it" },
};

/**
 * 触发价。加千分位，`2369` 读起来像编号，`2,369` 才一眼是价格。
 *
 * 小数位按量级给：一美元以下的币（0.09426、0.01467 这种）必须留够 6 位，
 * 统一取 2 位会把它们全压成 0.09 —— 那个数字对使用者毫无意义。
 */
export function fmtTriggerPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 });
}

/**
 * 把订阅行存的 locale（zh-CN / en-US / ms-MY）映射到这张表的两语。
 *
 * ms-MY 落到英文是已知的不对称，跟 Telegram 侧一致。给马来语用户看英文场景名，
 * 好过给他一个 undefined。
 */
export function pickAlertLang(locale: string): AlertCopyLang {
  return locale.startsWith("zh") ? "zh" : "en";
}
