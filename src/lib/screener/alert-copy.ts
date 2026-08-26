import type { ScenarioKind } from "./factors/scenario";

/**
 * 警报卡的文案表。Telegram 与 Web Push 两个通道共用。
 *
 * 共用不是为了省几行——两个通道说的是**同一个事件**，文案各写一份就会分叉：
 * Telegram 说「反手做空」而系统推送说「考虑做空」，读的人无从判断哪个是准的。
 * 场景名与操作文案原样取自 brief 的六场景速查表，改这里之前先去改那张表。
 *
 * 只有 zh / en 两语。推送订阅的 locale 有 ms-MY，它会落到 en（见 pickAlertLang）。
 * 这跟 Telegram 侧的 TelegramMessageLang 是同一个取值集合，但不复用那个类型——
 * telegram-push.ts 会拉进 Supabase 依赖，而这个模块必须保持纯净：
 * lib/push/messages.ts 要在 cron 路由里 import 它。
 */
export type AlertCopyLang = "en" | "zh";

/** 场景名，跟 brief 里六场景速查表用的中文名一一对应，英文是直译。 */
export const SCENARIO_LABELS: Record<AlertCopyLang, Record<ScenarioKind, string>> = {
  zh: {
    healthy_trend: "健康趋势",
    inventory_flush: "存量清算",
    true_top_div: "真顶背离",
    true_bottom_div: "真底背离",
    false_top_div: "假顶背离",
    false_bottom_div: "假底背离",
  },
  en: {
    healthy_trend: "Healthy Trend",
    inventory_flush: "Inventory Flush",
    true_top_div: "True Top Divergence",
    true_bottom_div: "True Bottom Divergence",
    false_top_div: "False Top Divergence",
    false_bottom_div: "False Bottom Divergence",
  },
};

/** 操作文案，原样取自 brief 六场景速查表最后一列——不重新措辞，避免文案与判定表脱节。 */
export const SCENARIO_ACTIONS: Record<AlertCopyLang, Record<ScenarioKind, string>> = {
  zh: {
    healthy_trend: "顺势，回调进场",
    inventory_flush: "分批止盈，等反手",
    true_top_div: "反手做空",
    true_bottom_div: "反手做多",
    false_top_div: "禁止做空，顺势做多",
    false_bottom_div: "禁止做多，顺势做空",
  },
  en: {
    healthy_trend: "Follow the trend, enter on pullback",
    inventory_flush: "Scale out, wait for reversal",
    true_top_div: "Reverse to short",
    true_bottom_div: "Reverse to long",
    false_top_div: "Do not short — follow trend, go long",
    false_bottom_div: "Do not long — follow trend, go short",
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
