import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  getTelegramPushSettings,
  listTargetsFor,
  deliverToTargets,
  escapeHtml,
  markPushAttempt,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import type { AlertCardData } from "./cards";
import type { ScenarioKind } from "./factors/scenario";

/**
 * 没发成的卡片 key。
 *
 * 推送本身不排队——有新卡就发。这里攒的只有两种：投递失败（Telegram 抖动、
 * 429）整批留到下一轮重试，以及超过单条消息上限被切下来的那部分。两种都是
 * 「发不出去」而不是「不该发」，所以下一轮扫描会连同当轮的新卡一起再试。
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
  { title: string; long: string; short: string; manage: string; count: (n: number) => string }
> = {
  en: {
    title: "🚨 Scanner Alert",
    long: "LONG",
    short: "SHORT",
    manage: "MANAGE",
    count: (n) => `${n} signal${n === 1 ? "" : "s"}`,
  },
  zh: {
    title: "🚨 扫描器警报",
    long: "做多",
    short: "做空",
    manage: "观望",
    count: (n) => `${n} 个信号`,
  },
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

/** 方向对应的圆点。分组标题上有它，行内就不必再写一遍方向 */
const DIRECTION_DOT = { long: "🟢", short: "🔴", manage: "🟡" } as const;

/**
 * 触发价。加千分位，`2369` 读起来像编号，`2,369` 才一眼是价格。
 *
 * 小数位按量级给：一美元以下的币（0.09426、0.01467 这种）必须留够 6 位，
 * 统一取 2 位会把它们全压成 0.09 —— 那个数字对使用者毫无意义。
 */
function fmtTriggerPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 });
}

/**
 * 一张卡属于哪一组。同一种触发 + 同一个方向 = 同一组。
 *
 * 方向必须进 key：healthy_trend 既可能是 long 也可能是 short，合成一组的话
 * 标题上那个方向就是错的。
 */
function groupKey(a: AlertCardData): string {
  const tr = a.trigger;
  return tr.type === "scenario"
    ? `s:${tr.scenario.kind}:${a.direction}`
    : `i:${tr.ignition.direction}`;
}

function groupHeading(a: AlertCardData, lang: TelegramMessageLang): string {
  const s = STRINGS[lang];
  const dir = a.direction === "long" ? s.long : a.direction === "short" ? s.short : s.manage;
  // 直接在 trigger 上分支，不抽成布尔量——抽出来 TypeScript 就不再收窄
  // 这个联合类型，两支都会去访问对方没有的字段。
  const tr = a.trigger;
  const name =
    tr.type === "scenario"
      ? SCENARIO_LABELS[lang][tr.scenario.kind]
      : IGNITION_LABELS[lang][tr.ignition.direction];
  const action =
    tr.type === "scenario" ? SCENARIO_ACTIONS[lang][tr.scenario.kind] : IGNITION_LABELS[lang].action;
  // 陷阱场景用 ⚠️ **顶掉**方向圆点，而不是排在它前面：两个 emoji 并排既挤又
  // 分不清主次，而对这类场景「这是个陷阱」本来就比「往哪个方向」更该先看到。
  // 方向没有丢——紧接着的 dir 那一格就是。
  // 陷阱场景的操作方向跟直觉相反（背离却要顺势），不提醒容易被看错成普通背离。
  const trap = tr.type === "scenario" && tr.scenario.trap;
  return `${trap ? "⚠️" : DIRECTION_DOT[a.direction]} <b>${name}</b> · ${dir} · ${action}`;
}

/**
 * 多条警报合并成**一条**消息，按触发类型分组。
 *
 * 分组不是排版偏好，是这条消息**可读性的全部**。上一版每张卡自成一行，行里
 * 依次是 币种·方向·场景名·操作文案·因子·锁定价——而一轮扫描触发的卡片
 * 绝大多数是同一种触发（点火尤其如此：区间突破往往是全市场同时发生的）。
 * 线上真实的一条：15 行里 "Ignition Up · Just broke range — follow it" 印了
 * 15 遍，每行都因此折行，真正有区别的三样东西（币种、触发价、因子）被挤到
 * 换行之后。读者要在重复文本里找不重复的部分，而那正好是反过来的。
 *
 * 现在重复的话在组标题上说一次，行内只留每张卡**独有**的信息，一行装得下：
 *
 *   🚨 扫描器警报 · 15 个信号
 *
 *   🟢 <b>向上点火</b> · 做多 · 刚突破区间，顺势跟
 *   <b>PENDLE</b> @1.8305 · OI60/CVD9
 *   <b>ICP</b> @2.455 · OI44/CVD10
 *
 * 组的先后按各组第一张卡在入参里的位置，而入参是按总分降序的——于是最强的
 * 那一组排在最前面，组内也仍然是降序。
 */
export function formatAlertMessage(alerts: AlertCardData[], lang: TelegramMessageLang): string {
  const s = STRINGS[lang];
  // Map 保插入顺序，分组因此天然继承入参的总分降序
  const groups = new Map<string, AlertCardData[]>();
  for (const a of alerts) {
    const key = groupKey(a);
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }

  const blocks = [...groups.values()].map((cards) => {
    const rows = cards.map((a) => {
      const coin = escapeHtml(a.symbol.replace(/-USDT$/, ""));
      return `<b>${coin}</b> @${fmtTriggerPrice(a.firstPrice)} · OI${a.factors.oi}/CVD${a.factors.cvd}`;
    });
    return [groupHeading(cards[0], lang), ...rows].join("\n");
  });

  // 组与组之间空一行——Telegram 不渲染任何分隔线，空行是唯一能用的分组信号
  return [`${s.title} · ${s.count(alerts.length)}`, ...blocks].join("\n\n");
}

/**
 * 一次警报推送的结果。
 *
 * 不再只返回一个数字：`pushed=0` 可以是「总开关关着」「没有目标群」「没配 token」
 * 「本轮没有新事」——处置完全不同，而路由日志里只看得到那个 0。
 */
export interface AlertPushOutcome {
  /** 实际发出去的卡片数 */
  pushed: number;
  /** 投递失败或被单条上限挡下、留到下一轮的卡片数 */
  held: number;
  /** 至少一个目标收到了 */
  delivered: boolean;
  skippedReason?: "disabled" | "no_targets" | "no_token" | "nothing_new";
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
 * 有新警报卡就推。**纯事件驱动，没有任何时间闸。**
 *
 * 此前 scanner 推的是「每 4 小时一张排行榜」，由 telegram-push 那条 cron 按
 * 间隔触发。改成事件驱动的理由很直接：榜单挑的是**还没动**的币，本来就没有
 * 时效可言，隔多久发一次都行；而警报卡是「某个币刚刚发生了结构事件」，
 * 它的全部价值都在时效上，等下一个四小时窗口等于没有。
 *
 * 中间版本还留过一道「最小推送间隔」的节流闸（复用 push_interval_minutes），
 * 也一并拆掉了。它是把时间驱动换了个名字留下来：够不够钟仍然由时钟说了算，
 * 一条刚触发的警报会被压到下一个窗口——而那恰恰是这次改造要消除的东西。
 * 刷屏的顾虑本来就不成立：一轮扫描的全部新卡合并成**一条**消息，而扫描
 * 自己有 15 分钟门控（SCAN_INTERVAL_MS），上限就是每 15 分钟一条。
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
  // 静音」，不是「把没发成的那些删掉」。重新打开时 pending 里过期的那些
  // 会在下面跟当轮 cards 求交集时自然消失，不会倒出一堆几天前的旧警报。
  if (!settings.enabled) return NOTHING("disabled");

  const targets = await listTargetsFor("screener");
  if (targets.length === 0) return NOTHING("no_targets");
  if (!settings.botToken && targets.every((t) => !t.botToken)) return NOTHING("no_token");

  // 候选 = 上一轮没发成的 + 当轮新出的，再跟当轮仍然成立的卡片求交集。
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

  // 到这里就发，不看表。
  return deliverAlerts(queue, settings, targets, "cron");
}

/**
 * 后台「立即推送」：把**当前所有有效警报卡**发一遍，绕过总开关。
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
  // 注意这不是节流——没发出去才留，发出去的当场就清掉。
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
