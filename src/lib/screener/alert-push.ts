import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  getTelegramPushSettings,
  listTargetsFor,
  deliverToTargets,
  escapeHtml,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import type { AlertCardData } from "./cards";
import type { ScenarioKind } from "./factors/scenario";

const SETTINGS_KEY = "screener_alert_push";

export interface AlertPushConfig {
  enabled: boolean;
}

/**
 * 默认**关闭**。一个新上线的功能不该自己开始往用户的 Telegram 群里发消息——
 * 15 分钟一扫、整池 150 个币，开着不管一天可以推出几十条。
 * 要开就去后台显式打开。
 *
 * minScore 字段已删除：T22 之前它的意义是「只推分数够高的」，但触发
 * 条件从「总分达标」换成了「检测到场景」之后，能走到 pushNewAlerts
 * 这一步的警报本来就已经是「场景命中」这个相对稀疏的事件（大多数币
 * 大多数时候无场景），不再需要叠一层分数门槛去筛"够不够强"。以后
 * 如果要按场景维度过滤（比如「只推非陷阱场景」），应该加一个新的、
 * 语义对应场景的开关，而不是复活 minScore 这个已经不成立的概念。
 * 后台旧配置里如果还留着 minScore 字段，这里直接忽略它——不读取、
 * 不校验、也不报错，跟没有这个字段时的行为完全一样。
 */
export function parseAlertPushConfig(value: unknown): AlertPushConfig {
  const fallback: AlertPushConfig = { enabled: false };
  if (!value || typeof value !== "object") return fallback;

  const v = value as Record<string, unknown>;
  const enabled = typeof v.enabled === "boolean" ? v.enabled : false;
  return { enabled };
}

export async function getAlertPushConfig(): Promise<AlertPushConfig> {
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("admin_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    return parseAlertPushConfig((data as { value?: unknown } | null)?.value ?? null);
  } catch {
    // 读不到配置一律当成关闭：宁可漏推，也不要因为一次 DB 抖动
    // 就按默认值开始往群里发消息。
    return { enabled: false };
  }
}

const STRINGS: Record<
  TelegramMessageLang,
  { title: string; long: string; short: string; manage: string; at: string }
> = {
  en: { title: "🚨 Scanner Alert", long: "LONG", short: "SHORT", manage: "MANAGE", at: "locked at" },
  zh: { title: "🚨 扫描器警报", long: "做多", short: "做空", manage: "观望", at: "锁定价" },
};

/** 场景名，跟 brief 里六场景速查表用的中文名一一对应，英文是直译。 */
const SCENARIO_LABELS: Record<TelegramMessageLang, Record<ScenarioKind, string>> = {
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
const SCENARIO_ACTIONS: Record<TelegramMessageLang, Record<ScenarioKind, string>> = {
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
const IGNITION_LABELS: Record<TelegramMessageLang, { up: string; down: string; action: string }> = {
  zh: { up: "向上点火", down: "向下点火", action: "刚突破区间，顺势跟" },
  en: { up: "Ignition Up", down: "Ignition Down", action: "Just broke range — follow it" },
};

/**
 * 多条警报合并成**一条**消息。一轮扫描同时触发五六个币是常有的事，
 * 一条一发就是刷屏，而 Telegram 对同一个 chat 的连发也有速率限制。
 *
 * 每一行带场景名与操作文案（T22 新增）：警报已经是场景驱动的了，
 * 光看方向/分数不知道"现在是哪种局面、该怎么办"，这两样信息补上
 * 这道空。陷阱场景（false_top_div/false_bottom_div）在行首加 ⚠ 前缀——
 * 这类场景的操作方向跟直觉相反（背离却要顺势），不额外提醒容易被
 * 看错成普通背离。
 */
export function formatAlertMessage(alerts: AlertCardData[], lang: TelegramMessageLang): string {
  const s = STRINGS[lang];
  const lines = alerts.map((a) => {
    const dir = a.direction === "long" ? s.long : a.direction === "short" ? s.short : s.manage;
    const coin = escapeHtml(a.symbol.replace(/-USDT$/, ""));
    const f = a.factors;
    // 直接在 trigger 上分支，不抽成布尔量——抽出来 TypeScript 就不再收窄
    // 这个联合类型，两支都会去访问对方没有的字段。
    const tr = a.trigger;
    const name =
      tr.type === "scenario"
        ? SCENARIO_LABELS[lang][tr.scenario.kind]
        : IGNITION_LABELS[lang][tr.ignition.direction];
    const action =
      tr.type === "scenario" ? SCENARIO_ACTIONS[lang][tr.scenario.kind] : IGNITION_LABELS[lang].action;
    const trapPrefix = tr.type === "scenario" && tr.scenario.trap ? "⚠ " : "";
    return (
      `${trapPrefix}<b>${coin}</b> ${dir} · ${name} · ${action} · ` +
      `OI${f.oi}/CVD${f.cvd} · ` +
      `${s.at} ${a.firstPrice}`
    );
  });
  return `${s.title}\n\n${lines.join("\n")}`;
}

/**
 * 推送新触发的警报。返回实际推送的条数。
 *
 * 只接 Telegram，不接 web-push：现有 web-push 的语义是「用户自己设的
 * 某个币的价格提醒」，是用户主动订阅的。把全站扫描器的警报塞进同一个
 * 通道，等于给所有订阅过价格提醒的人推他们从没要求过的东西。
 * 要接的话应该是一个独立的订阅开关，那是另一个功能。
 */
export async function pushNewAlerts(alerts: AlertCardData[]): Promise<number> {
  if (alerts.length === 0) return 0;

  const config = await getAlertPushConfig();
  if (!config.enabled) return 0;

  // 不再按 minScore 过滤：能传进来的 alerts 已经是「检测到场景」这个
  // 唯一触发条件筛过的结果，见 parseAlertPushConfig 顶部注释。

  const settings = await getTelegramPushSettings();
  // 总开关关掉时一条都不发。榜单推送（pushScreenerToTelegram）就是这么做的，
  // 警报没有理由绕过它——运营关掉 Telegram 推送的意思是「让机器人静音」，
  // 而不是「只静音榜单、警报继续发」。
  if (!settings.enabled) return 0;
  const targets = await listTargetsFor("screener");
  if (targets.length === 0) return 0;
  if (!settings.botToken && targets.every((t) => !t.botToken)) return 0;

  const results = await deliverToTargets(
    settings,
    targets,
    (lang) => formatAlertMessage(alerts, lang),
    "cron"
  );

  if (!results.some((r) => r.ok)) return 0;

  return alerts.length;
}
