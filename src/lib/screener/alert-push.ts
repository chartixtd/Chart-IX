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
import { MEMO_TTL_MS } from "./cards-store";
import {
  scenarioLabel,
  scenarioAction,
  IGNITION_LABELS,
  fmtTriggerPrice,
} from "./alert-copy";

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
 * 已经推送过的卡片 key —— 一张卡这辈子只推一次的**唯一保证**。
 *
 * 在此之前，「不重复推」完全依赖 newCards 是对的，而 newCards 的定义是
 * 「这一轮在备忘表里刚建的那些」。那份推断在三种情况下会静默塌掉，全都会
 * 表现成「已经推过的卡片又推了一遍」：
 *
 * 1. readMemos() 读失败 → 返回空 Map，那一轮**每张**卡都是「第一次看到」，
 *    整块警报栏重推一遍（cards-store.ts 自己的注释就写着这个后果）；
 * 2. saveMemos() 写失败 → 下一轮它们又是新的；
 * 3. 钥匙漂移 → 同一个事件换了个 key，凭什么也认不出来。
 *
 * 1 和 2 是有意吞掉错误的降级路径（备忘表故障不该影响扫描本身），所以它们
 * 不会消失，只会偶发。台账把「推过没有」从推断变成**记录**：出问题时最坏是
 * 漏推（key 记进去了但其实没发出去，下面只在投递成功后才写），而不是刷屏。
 *
 * 保留期比备忘长一天：备忘一过期，同一个事件就会以「新卡」身份回来，台账
 * 必须活得比它久，否则正好在交接的那一刻漏出一条重复推送。
 */
const PUSHED_KEY = "screener_alert_pushed";

/** 台账保留期。MEMO_TTL_MS 是 8 天，这里给 9 天——必须严格长于备忘 */
const PUSHED_TTL_MS = MEMO_TTL_MS + 24 * 60 * 60 * 1000;

/**
 * 台账最多留多少条。
 *
 * 同时存在的结构事件是几十个量级，9 天的量级在几百条以内，2000 是留足余量的
 * 上限而不是预期值。撞到上限时丢最旧的：最旧的那些本来也最接近过期。
 */
const PUSHED_MAX = 2000;

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

/** 方向对应的圆点。分组标题上有它，行内就不必再写一遍方向 */
const DIRECTION_DOT = { long: "🟢", short: "🔴", manage: "🟡" } as const;

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
      ? scenarioLabel(lang, tr.scenario)
      : IGNITION_LABELS[lang][tr.ignition.direction];
  const action =
    tr.type === "scenario" ? scenarioAction(lang, tr.scenario) : IGNITION_LABELS[lang].action;
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
  // 已结束的卡（expired）只是留给人「找得到」用的，绝不能进推送队列——
  // 它们的信号已经没了，推出去就是在报一个过期的东西。
  const liveCards = payload.cards.filter((c) => !c.expired);
  const valid = new Map(liveCards.map((c) => [c.key, c]));
  const carried = (await readPendingKeys()).filter((k) => valid.has(k));
  const candidates = new Set([...carried, ...payload.newCards.map((c) => c.key)]);

  // 再拿台账筛一道：推过的一律不再推，不管它这一轮为什么又被算成了「新的」。
  // newCards 只是「按备忘表推断它是新的」，而备忘表的读写都有静默降级路径
  // （见 PUSHED_KEY 顶上那段），推断塌掉时整块警报栏会重推一遍。
  const pushed = await readPushedKeys();
  const queue = liveCards.filter((c) => candidates.has(c.key) && !pushed.has(c.key));

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
 *
 * 同理也**不查**已推送台账（否则等所有卡都推过之后这个按钮就永远发不出东西，
 * 恰好在排查「为什么没收到」时最没用），但发完照样**记进**台账——它们确实
 * 已经推出去了，自动推送不该再推一遍。
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

  // 台账**只在投递成功后**记，且只记这一条消息真的列出来的那些（batch，
  // 不含溢出）。反过来写的话，一次 Telegram 故障会把整批标记成「推过了」，
  // 而它们其实一条都没发出去——重复推送难看，静默漏推才是真的丢信号。
  if (delivered) await recordPushedKeys(batch.map((c) => c.key));

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

/** 台账的一行：key + 记录时刻(ms)。带时刻才能按保留期裁剪 */
type PushedEntry = [key: string, atMs: number];

function parsePushedEntries(value: unknown): PushedEntry[] {
  if (!Array.isArray(value)) return [];
  const out: PushedEntry[] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [k, at] = row;
    if (typeof k === "string" && typeof at === "number" && Number.isFinite(at)) out.push([k, at]);
  }
  return out;
}

/**
 * 读台账。
 *
 * 读失败返回空集合——那一轮退回到只靠 newCards 判断，也就是这个台账加进来
 * 之前的行为。最坏是重复推一次，而不是整轮推送因为一次 DB 抖动就没了。
 *
 * 对外导出是给 Web Push 扇出用的（见 cron/screener-scan）。台账由这个模块的
 * Telegram 路径写入，但两个通道在同一轮推的是**同一批卡**，所以扇出那边读它
 * 就够了，不需要再建一张自己的台账。
 */
export async function readPushedKeys(): Promise<Set<string>> {
  try {
    const { data } = await createServiceRoleClient()
      .from("admin_settings")
      .select("value")
      .eq("key", PUSHED_KEY)
      .maybeSingle();
    return new Set(parsePushedEntries((data as { value?: unknown } | null)?.value).map(([k]) => k));
  } catch {
    return new Set();
  }
}

/**
 * 把这批 key 记进台账，顺手裁掉过期的与超量的。
 *
 * 读-改-写有并发覆盖的风险（两轮扫描同时写，后写的赢），但这里的代价是
 * 可接受的：丢掉的是**别人刚记上的几个 key**，后果是那几张卡可能被重推一次，
 * 而不是漏推。为一张最多几百行的台账上锁不值得。
 */
async function recordPushedKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const now = Date.now();
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("admin_settings")
      .select("value")
      .eq("key", PUSHED_KEY)
      .maybeSingle();

    const fresh = parsePushedEntries((data as { value?: unknown } | null)?.value).filter(
      ([, at]) => now - at < PUSHED_TTL_MS
    );
    const seen = new Set(fresh.map(([k]) => k));
    for (const k of keys) {
      if (!seen.has(k)) {
        fresh.push([k, now]);
        seen.add(k);
      }
    }
    // 撞到上限时丢最旧的——它们本来也最接近过期
    const capped = fresh.length > PUSHED_MAX ? fresh.slice(fresh.length - PUSHED_MAX) : fresh;

    await client
      .from("admin_settings")
      .upsert({ key: PUSHED_KEY, value: capped }, { onConflict: "key" });
  } catch (err) {
    // 记不上的后果是这批卡可能被重推一次，不该让整轮推送记成失败——
    // 消息此刻已经发出去了。
    console.error("[alert-push] failed to record pushed keys", err);
  }
}
