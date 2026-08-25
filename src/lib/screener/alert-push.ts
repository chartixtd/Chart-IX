import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  getTelegramPushSettings,
  listTargetsFor,
  deliverToTargets,
  escapeHtml,
  isPushDue,
  markPushAttempt,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import type { AlertCardData } from "./cards";
import type { ScenarioKind } from "./factors/scenario";

/**
 * 攒起来还没发的卡片 key。
 *
 * 只存 key，不存卡片本身。发的时候拿 key 去当轮的 `cards` 里取——于是
 * 1) 发出去的永远是**此刻**的数据（现价、峰值），不是攒进去那一刻的快照；
 * 2) 攒着的期间事件已经结束（卡片不在了）的，自然消失，不会推一条过期警报。
 * 这两件事如果存整张卡就都得自己动手维护，而且都很容易忘。
 *
 * 放 admin_settings 而不是新开一张表：它本来就是这个项目放小状态的地方
 * （screener_alert_push、daily_briefing_last_run 都在这），而这里要存的
 * 是一个最多几十个字符串的数组。
 */
const PENDING_KEY = "screener_alert_pending";

/**
 * 一条消息最多列几张卡。
 *
 * Telegram 单条消息 4096 字符，一行警报约 90 字符，20 行还有三倍余量。
 * 超出的部分**不丢**，留在 pending 里下一轮接着发——一次剧烈行情里同时
 * 触发三十个币是可能的，而那种时候恰恰不能因为消息太长整条发不出去。
 */
export const MAX_ALERTS_PER_MESSAGE = 20;

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
 * 一次警报推送的结果。
 *
 * 不再只返回一个数字：`pushed=0` 可以是「总开关关着」「没有目标群」「被节流
 * 攒起来了」「本轮没有新事」——处置完全不同，而路由日志里只看得到那个 0。
 */
export interface AlertPushOutcome {
  /** 实际发出去的卡片数 */
  pushed: number;
  /** 被节流或被单条上限挡下、留到下一轮的卡片数 */
  held: number;
  /** 至少一个目标收到了 */
  delivered: boolean;
  skippedReason?: "disabled" | "no_targets" | "no_token" | "throttled" | "nothing_new";
}

const NOTHING = (reason: AlertPushOutcome["skippedReason"]): AlertPushOutcome => ({
  pushed: 0,
  held: 0,
  delivered: false,
  skippedReason: reason,
});

/** pushNewAlerts / pushActiveAlertsNow 只需要 payload 的这两块 */
export interface AlertPushInput {
  /** 当轮仍然成立的全部卡片，按总分降序 */
  cards: AlertCardData[];
  /** 当轮**新出现**的卡片 */
  newCards: AlertCardData[];
}

/**
 * 有新警报卡就推（T25 起，scanner 唯一的 Telegram 推送）。
 *
 * 此前 scanner 推的是「每 4 小时一张排行榜」，由 telegram-push 那条 cron 按
 * 间隔触发。改成事件驱动的理由很直接：榜单挑的是**还没动**的币，本来就没有
 * 时效可言，隔多久发一次都行；而警报卡是「某个币刚刚发生了结构事件」，
 * 它的全部价值都在时效上，等下一个四小时窗口等于没有。
 *
 * 开关沿用同一套，没有新增：`telegram_push_settings.enabled` 是总静音，
 * 目标群按 content=screener 订阅。原先那个默认关闭、后台又没有 UI 的
 * `screener_alert_push.enabled` 一并删掉——它的存在意义是「新功能不该自己
 * 开始发消息」，而现在它就是 scanner 推送本身，再挡一道等于永远不发。
 *
 * 只接 Telegram，不接 web-push：web-push 的扇出在调用方（screener-scan 路由）
 * 里，它按用户自己的订阅偏好走，跟 Telegram 的群配置是两套东西，混在
 * 一个函数里只会让「为什么没收到」更难查。
 */
export async function pushNewAlerts(payload: AlertPushInput): Promise<AlertPushOutcome> {
  const settings = await getTelegramPushSettings();
  // 总开关关掉时一条都不发，也**不动** pending：运营关掉的意思是「让机器人
  // 静音」，不是「把这段时间的事件删掉」。重新打开时 pending 里过期的那些
  // 会在下面跟当轮 cards 求交集时自然消失，不会倒出一堆几天前的旧警报。
  if (!settings.enabled) return NOTHING("disabled");

  const targets = await listTargetsFor("screener");
  if (targets.length === 0) return NOTHING("no_targets");
  if (!settings.botToken && targets.every((t) => !t.botToken)) return NOTHING("no_token");

  // 候选 = 攒着的 + 当轮新出的，再跟当轮仍然成立的卡片求交集。
  // 交集这一步同时做掉三件事：剔除已经失效的旧 key、去重、把顺序统一成
  // cards 的排序（总分降序），于是消息里最强的排在最前面。
  const valid = new Map(payload.cards.map((c) => [c.key, c]));
  const carried = (await readPendingKeys()).filter((k) => valid.has(k));
  const candidates = new Set([...carried, ...payload.newCards.map((c) => c.key)]);
  const queue = payload.cards.filter((c) => candidates.has(c.key));

  if (queue.length === 0) {
    await writePendingKeys([]);
    return NOTHING("nothing_new");
  }

  // 节流闸。距上次**成功**推送不够久时整批攒起来，不发也不丢。
  // 默认间隔是 0（不节流）——见 telegram-push.ts 的 pushIntervalMinutes。
  if (!isPushDue(settings.lastPushedAt, settings.pushIntervalMinutes)) {
    await writePendingKeys(queue.map((c) => c.key));
    return { pushed: 0, held: queue.length, delivered: false, skippedReason: "throttled" };
  }

  return deliverAlerts(queue, settings, targets, "cron");
}

/**
 * 后台「立即推送」：把**当前所有有效警报卡**发一遍，绕过总开关与节流。
 *
 * 绕过是有意的，跟原先的 pushScreenerNow 同一个理由——手动点一下就是明确
 * 的意图。它发的是 cards 而不是 newCards：手动触发时「这一轮有没有新事」
 * 通常是 0，那样点了没反应，等于按钮不能用来验证通道。
 */
export async function pushActiveAlertsNow(payload: AlertPushInput): Promise<AlertPushOutcome> {
  const settings = await getTelegramPushSettings();
  const targets = await listTargetsFor("screener");
  if (targets.length === 0) return NOTHING("no_targets");
  if (!settings.botToken && targets.every((t) => !t.botToken)) return NOTHING("no_token");
  if (payload.cards.length === 0) return NOTHING("nothing_new");

  return deliverAlerts(payload.cards, settings, targets, "manual");
}

async function deliverAlerts(
  queue: AlertCardData[],
  settings: Awaited<ReturnType<typeof getTelegramPushSettings>>,
  targets: Awaited<ReturnType<typeof listTargetsFor>>,
  trigger: "cron" | "manual"
): Promise<AlertPushOutcome> {
  const batch = queue.slice(0, MAX_ALERTS_PER_MESSAGE);
  const overflow = queue.slice(MAX_ALERTS_PER_MESSAGE);

  const results = await deliverToTargets(
    settings,
    targets,
    (lang) => formatAlertMessage(batch, lang),
    trigger
  );

  const delivered = results.some((r) => r.ok);
  const failed = results
    .filter((r) => !r.ok)
    .map((r) => `${r.label}: ${r.error ?? "unknown"}`)
    .join("; ");
  // 健康字段与节流基准是同一份 last_pushed_at，两者都只在成功时前进
  await markPushAttempt(delivered, failed ? failed.slice(0, 1000) : null);

  // 投递失败时整批留在 pending 下一轮重试；成功时只留溢出的那些。
  // 这是「警报不能丢」的最后一道：一次 Telegram 抖动不该让这批事件消失。
  const keep = delivered ? overflow : queue;
  await writePendingKeys(keep.map((c) => c.key));

  return {
    pushed: delivered ? batch.length : 0,
    held: keep.length,
    delivered,
  };
}

async function readPendingKeys(): Promise<string[]> {
  try {
    const { data } = await createServiceRoleClient()
      .from("admin_settings")
      .select("value")
      .eq("key", PENDING_KEY)
      .maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string");
  } catch {
    // 读不到就当没攒过。丢掉几个待发的 key，好过让一次 DB 抖动把整轮推送
    // 拖成异常——当轮的新卡片仍然会发出去，那才是这条路径的主产出。
    return [];
  }
}

async function writePendingKeys(keys: string[]): Promise<void> {
  try {
    await createServiceRoleClient()
      .from("admin_settings")
      .upsert({ key: PENDING_KEY, value: keys }, { onConflict: "key" });
  } catch (err) {
    console.error("[alert-push] failed to persist pending keys", err);
  }
}
