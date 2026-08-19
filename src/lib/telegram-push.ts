import { encrypt, decrypt } from "@/lib/crypto";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { getScannerPayload } from "@/lib/screener/cache";
import {
  sendTelegramMessage,
  type TelegramSendOptions,
  type TelegramSendResult,
} from "@/lib/telegram-send";
import type { ScannerRow, ScannerPayload, Direction } from "@/lib/screener/types";
import { CLIENT_SLIDER } from "@/lib/screener/universe";
import type { ScenarioKind } from "@/lib/screener/factors/scenario";

export type TelegramMessageLang = "en" | "zh";
export type PushTrigger = "cron" | "manual" | "test" | "briefing";

/**
 * What a destination is subscribed to. A destination is a chat *and* an optional
 * topic, so "screener into 行情播报, briefing into 每日早报" is two rows on the
 * same chat rather than two parallel configuration systems.
 */
export type PushContentKind = "screener" | "briefing";

export interface TelegramPushSettings {
  enabled: boolean;
  /** Decrypted; null when never configured */
  botToken: string | null;
  /** Legacy single-destination column. Superseded by telegram_push_targets; kept for rollback only. */
  chatId: string | null;
  /** Language the pushed message text itself is written in — independent of the admin UI's language */
  messageLang: TelegramMessageLang;
  pushIntervalMinutes: number;
  showPrice: boolean;
  showChange24h: boolean;
  showAmplitude: boolean;
  showMarketCap: boolean;
  showVolume: boolean;
  /**
   * 方向标记。DB 列仍叫 show_oi_ratio —— 四因子模型里没有 OI/量比这个字段了，
   * 但这一列的语义（"表格里多显示一栏"）可以原样承接，为一个纯展示开关
   * 加一次迁移不值得。改名只发生在 TS 这一侧，读写映射见 getTelegramPushSettings。
   */
  showDirection: boolean;
  showFunding: boolean;
  showScore: boolean;
  /**
   * 因子构成。DB 列仍叫 show_edge，理由同上——edge 这个概念随
   * 6 维模型一起退役了，这一列先后承接过"显示 Zone/Sweep/OI/CVD 明细"
   * （四因子模型）与现在的"显示 OI/CVD 明细"（T21 退役 Zone/Sweep 后的
   * 两因子模型），列名本身不再改。
   */
  showFactors: boolean;
  lastPushedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  updatedAt: string;
}

export interface TelegramTarget {
  id: string;
  label: string;
  chatId: string;
  /**
   * Forum topic inside `chatId`. null posts to the chat's General topic, which
   * is where every message went before topics were supported.
   */
  messageThreadId: number | null;
  /** Decrypted per-target override; null means "use the global bot token". */
  botToken: string | null;
  botTokenConfigured: boolean;
  /** null means "inherit settings.messageLang" */
  messageLang: TelegramMessageLang | null;
  enabled: boolean;
  /** Receives the scheduled screener list. */
  pushScreener: boolean;
  /** Receives the daily briefing's article link. */
  pushBriefing: boolean;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  sortOrder: number;
}

interface TelegramPushRow {
  enabled: boolean;
  bot_token_encrypted: string | null;
  chat_id: string | null;
  message_lang: TelegramMessageLang;
  push_interval_minutes: number;
  show_price: boolean;
  show_change_24h: boolean;
  show_amplitude: boolean;
  show_market_cap: boolean;
  show_volume: boolean;
  show_oi_ratio: boolean;
  show_funding: boolean;
  show_score: boolean;
  show_edge: boolean;
  last_pushed_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  updated_at: string;
}

interface TelegramTargetRow {
  id: string;
  label: string;
  chat_id: string;
  message_thread_id: number | null;
  bot_token_encrypted: string | null;
  message_lang: TelegramMessageLang | null;
  enabled: boolean;
  push_screener: boolean;
  push_briefing: boolean;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  sort_order: number;
}

function rowToSettings(row: TelegramPushRow): TelegramPushSettings {
  return {
    enabled: row.enabled,
    botToken: row.bot_token_encrypted ? decrypt(row.bot_token_encrypted) : null,
    chatId: row.chat_id,
    messageLang: row.message_lang,
    pushIntervalMinutes: row.push_interval_minutes,
    showPrice: row.show_price,
    showChange24h: row.show_change_24h,
    showAmplitude: row.show_amplitude,
    showMarketCap: row.show_market_cap,
    showVolume: row.show_volume,
    showDirection: row.show_oi_ratio,
    showFunding: row.show_funding,
    showScore: row.show_score,
    showFactors: row.show_edge,
    lastPushedAt: row.last_pushed_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    updatedAt: row.updated_at,
  };
}

function rowToTarget(row: TelegramTargetRow): TelegramTarget {
  return {
    id: row.id,
    label: row.label,
    chatId: row.chat_id,
    messageThreadId: row.message_thread_id ?? null,
    botToken: row.bot_token_encrypted ? decrypt(row.bot_token_encrypted) : null,
    botTokenConfigured: Boolean(row.bot_token_encrypted),
    messageLang: row.message_lang,
    enabled: row.enabled,
    // Defaulted rather than trusted so that a deploy landing before migration 046
    // degrades to the old behaviour (every target is a screener target) instead
    // of reading `undefined`, filtering every target out, and silently stopping
    // the screener push — exactly the failure mode 035 was written to end.
    pushScreener: row.push_screener ?? true,
    pushBriefing: row.push_briefing ?? false,
    lastOkAt: row.last_ok_at,
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    sortOrder: row.sort_order,
  };
}

export async function getTelegramPushSettings(): Promise<TelegramPushSettings> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("telegram_push_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "telegram_push_settings row missing");
  }

  return rowToSettings(data as TelegramPushRow);
}

export async function listTelegramTargets(): Promise<TelegramTarget[]> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("telegram_push_targets")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as TelegramTargetRow[]).map(rowToTarget);
}

/**
 * Enabled destinations subscribed to one kind of content.
 *
 * Filtering here rather than in SQL keeps a single decrypt/normalise path for
 * targets; the table holds a handful of rows, so the read is not worth splitting.
 */
export async function listTargetsFor(kind: PushContentKind): Promise<TelegramTarget[]> {
  const all = await listTelegramTargets();
  return all.filter((t) => t.enabled && (kind === "screener" ? t.pushScreener : t.pushBriefing));
}

export interface TelegramPushUpdate {
  enabled?: boolean;
  /** Pass to rotate the stored token; omit to leave it untouched. */
  botToken?: string;
  messageLang?: TelegramMessageLang;
  pushIntervalMinutes?: number;
  showPrice?: boolean;
  showChange24h?: boolean;
  showAmplitude?: boolean;
  showMarketCap?: boolean;
  showVolume?: boolean;
  showDirection?: boolean;
  showFunding?: boolean;
  showScore?: boolean;
  showFactors?: boolean;
}

export const MIN_PUSH_INTERVAL_MINUTES = 15;
export const MAX_PUSH_INTERVAL_MINUTES = 10080; // one week

export async function updateTelegramPushSettings(
  update: TelegramPushUpdate
): Promise<TelegramPushSettings> {
  const client = createServiceRoleClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (update.enabled !== undefined) patch.enabled = update.enabled;
  if (update.botToken !== undefined) {
    patch.bot_token_encrypted = update.botToken.trim() ? encrypt(update.botToken.trim()) : null;
  }
  if (update.messageLang !== undefined) patch.message_lang = update.messageLang;
  if (update.pushIntervalMinutes !== undefined) {
    const n = Math.round(update.pushIntervalMinutes);
    if (!Number.isFinite(n) || n < MIN_PUSH_INTERVAL_MINUTES || n > MAX_PUSH_INTERVAL_MINUTES) {
      throw new Error(
        `pushIntervalMinutes must be between ${MIN_PUSH_INTERVAL_MINUTES} and ${MAX_PUSH_INTERVAL_MINUTES}`
      );
    }
    patch.push_interval_minutes = n;
  }
  if (update.showPrice !== undefined) patch.show_price = update.showPrice;
  if (update.showChange24h !== undefined) patch.show_change_24h = update.showChange24h;
  if (update.showAmplitude !== undefined) patch.show_amplitude = update.showAmplitude;
  if (update.showMarketCap !== undefined) patch.show_market_cap = update.showMarketCap;
  if (update.showVolume !== undefined) patch.show_volume = update.showVolume;
  if (update.showDirection !== undefined) patch.show_oi_ratio = update.showDirection;
  if (update.showFunding !== undefined) patch.show_funding = update.showFunding;
  if (update.showScore !== undefined) patch.show_score = update.showScore;
  if (update.showFactors !== undefined) patch.show_edge = update.showFactors;

  const { data, error } = await client
    .from("telegram_push_settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to update telegram_push_settings");
  return rowToSettings(data as TelegramPushRow);
}

// ---------------------------------------------------------------------------
// Target CRUD
// ---------------------------------------------------------------------------

export interface TelegramTargetInput {
  label: string;
  chatId: string;
  /** null (or omitted on create) posts to the chat's General topic. */
  messageThreadId?: number | null;
  /** Empty string clears the per-target override (falls back to the global token). */
  botToken?: string;
  messageLang?: TelegramMessageLang | null;
  enabled?: boolean;
  pushScreener?: boolean;
  pushBriefing?: boolean;
  sortOrder?: number;
}

export async function createTelegramTarget(input: TelegramTargetInput): Promise<TelegramTarget> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("telegram_push_targets")
    .insert({
      label: input.label.trim(),
      chat_id: input.chatId.trim(),
      message_thread_id: input.messageThreadId ?? null,
      bot_token_encrypted: input.botToken?.trim() ? encrypt(input.botToken.trim()) : null,
      message_lang: input.messageLang ?? null,
      enabled: input.enabled ?? true,
      // Defaults mirror the column defaults: a new destination starts on the
      // screener (what every existing one does) and opts into the briefing.
      push_screener: input.pushScreener ?? true,
      push_briefing: input.pushBriefing ?? false,
      sort_order: input.sortOrder ?? 0,
    })
    .select("*")
    .single();

  if (error) {
    // 23505 = the unique index on (chat_id, topic); a duplicate would double-send.
    if (error.code === "23505") throw new Error("duplicate_chat_id");
    throw new Error(error.message);
  }
  return rowToTarget(data as TelegramTargetRow);
}

export async function updateTelegramTarget(
  id: string,
  input: Partial<TelegramTargetInput>
): Promise<TelegramTarget> {
  const client = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.chatId !== undefined) patch.chat_id = input.chatId.trim();
  if (input.messageThreadId !== undefined) patch.message_thread_id = input.messageThreadId;
  if (input.botToken !== undefined) {
    patch.bot_token_encrypted = input.botToken.trim() ? encrypt(input.botToken.trim()) : null;
  }
  if (input.messageLang !== undefined) patch.message_lang = input.messageLang;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.pushScreener !== undefined) patch.push_screener = input.pushScreener;
  if (input.pushBriefing !== undefined) patch.push_briefing = input.pushBriefing;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

  const { data, error } = await client
    .from("telegram_push_targets")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("duplicate_chat_id");
    throw new Error(error.message);
  }
  if (!data) throw new Error("target_not_found");
  return rowToTarget(data as TelegramTargetRow);
}

export async function deleteTelegramTarget(id: string): Promise<void> {
  const client = createServiceRoleClient();
  const { error } = await client.from("telegram_push_targets").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 });
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Telegram's HTML parse_mode only needs these three escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MESSAGE_STRINGS: Record<
  TelegramMessageLang,
  {
    title: string;
    empty: string;
    long: string;
    short: string;
    price: string;
    change24h: string;
    amplitude: string;
    marketCap: string;
    volume: string;
    funding: string;
    score: string;
  }
> = {
  en: {
    title: "Chart-IX Scanner",
    empty: "(no candidates right now)",
    long: "LONG",
    short: "SHORT",
    price: "Price",
    change24h: "24h",
    amplitude: "Amp",
    marketCap: "MCap",
    volume: "Vol",
    funding: "Funding",
    score: "Score",
  },
  zh: {
    title: "Chart-IX 扫描器",
    empty: "（当前暂无符合条件的品种）",
    long: "做多",
    short: "做空",
    price: "价格",
    change24h: "24h",
    amplitude: "振幅",
    marketCap: "市值",
    volume: "成交量",
    funding: "费率",
    score: "总分",
  },
};

/**
 * 场景中文/英文名，跟 alert-push.ts 里给警报推送用的同一份名称保持一致。
 * 不能反过来从 alert-push.ts import——那边已经 import 了 telegram-push.ts
 * 的 deliverToTargets 等，import 反过来会成环，所以这里维护第二份定义。
 */
const SCANNER_SCENARIO_LABELS: Record<TelegramMessageLang, Record<ScenarioKind, string>> = {
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

/**
 * Telegram 单条消息有 4096 字符上限，一条 15 行的表离上限还有余量。
 * 榜单已按总分降序排好，截断只会丢掉分数最低的那些。
 */
function formatScannerRow(
  r: ScannerRow,
  settings: TelegramPushSettings,
  lang: TelegramMessageLang
): string {
  const s = MESSAGE_STRINGS[lang];
  const symbol = escapeHtml(r.coin);
  const parts: string[] = [];

  if (settings.showDirection) parts.push(r.direction === "long" ? s.long : s.short);
  // 场景名不受任何 show* 开关控制——它不是一个可关的展示字段，是这一行
  // 为什么会出现在榜单里的判据本身（跟警报推送 formatAlertMessage 同一
  // 个原则）。陷阱场景加 ⚠ 前缀，理由同 alert-push.ts：陷阱场景的操作
  // 方向跟直觉相反，不提醒容易被看错成普通背离。
  if (r.scenario) {
    const label = SCANNER_SCENARIO_LABELS[lang][r.scenario.kind];
    parts.push(`${r.scenario.trap ? "⚠ " : ""}${label}`);
  }
  if (settings.showScore) parts.push(`${s.score} ${r.total}`);
  if (settings.showFactors) {
    parts.push(`OI${r.factors.oi}/CVD${r.factors.cvd}`);
  }
  if (settings.showPrice) parts.push(`${s.price} ${fmtPrice(r.price)}`);
  if (settings.showChange24h && r.change24h !== null) {
    parts.push(`${s.change24h} ${fmtPercent(r.change24h)}`);
  }
  if (settings.showAmplitude) parts.push(`${s.amplitude} ${r.amplitude.toFixed(1)}%`);
  if (settings.showMarketCap) parts.push(`${s.marketCap} $${(r.marketCap / 1_000_000).toFixed(1)}M`);
  if (settings.showVolume) parts.push(`${s.volume} $${(r.volumeUsd / 1_000_000).toFixed(1)}M`);
  // null 与 0 必须区分开：0 是一个完全真实的资金费率，
  // 拿它显示"没数据"会让人以为这个币此刻不收费率。
  if (settings.showFunding && r.fundingRate !== null) {
    parts.push(`${s.funding} ${fmtPercent(r.fundingRate * 100)}`);
  }

  return parts.length > 0 ? `<b>${symbol}</b> — ${parts.join(" · ")}` : `<b>${symbol}</b>`;
}

/**
 * 推送用的振幅门槛。与界面滑块的最小值同源（`CLIENT_SLIDER.amplitude.min`）——
 * 群里收到的榜单必须和用户把滑块拉到最松时看到的是同一批币，
 * 两边各写一个数字迟早会对不上。
 *
 * 成交量与市值不在这里过滤：它们已经是服务端固定门槛，
 * payload 里的行必然已经达标。
 */
const PUSH_MIN_AMPLITUDE = CLIENT_SLIDER.amplitude.min;

/** 每一组最多列几行。两组加起来仍要留在 Telegram 单条消息 4096 字符以内。 */
const MAX_PUSH_ROWS_PER_GROUP = 8;

function formatScannerGroup(
  direction: Direction,
  rows: ScannerRow[],
  settings: TelegramPushSettings,
  lang: TelegramMessageLang
): string {
  const s = MESSAGE_STRINGS[lang];
  const emoji = direction === "long" ? "🟢" : "🔴";
  const label = direction === "long" ? s.long : s.short;
  if (rows.length === 0) return `${emoji} <b>${label}</b>\n${s.empty}`;

  const lines = rows
    .slice(0, MAX_PUSH_ROWS_PER_GROUP)
    .map((r, i) => `${i + 1}. ${formatScannerRow(r, settings, lang)}`);
  return `${emoji} <b>${label}</b>\n${lines.join("\n")}`;
}

/**
 * 做多与做空**分成两组**，不混在一张表里。
 *
 * 一份混排的榜单要求读者自己在每一行里找方向标记，而看盘时的问题
 * 从来都是「现在有什么可以做多的」或「有什么可以做空的」，不是
 * 「按分数从高到低都有什么」。分组之后每一行的方向由所在分组决定，
 * 行内那个方向标记就成了冗余——但仍然保留，因为 showDirection
 * 是用户可关的开关，关掉之后分组标题就是唯一的方向信息。
 *
 * 每个币只会出现在一组里（四因子模型给每个币定死一个方向），
 * 所以分组不会把同一批币印两遍。
 */
export function formatScannerMessage(
  payload: ScannerPayload,
  settings: TelegramPushSettings,
  lang: TelegramMessageLang = settings.messageLang
): string {
  const s = MESSAGE_STRINGS[lang];
  const timestamp = new Date(payload.computedAt).toISOString().replace("T", " ").slice(0, 16);
  const head = `📊 <b>${s.title}</b> · ${timestamp} UTC`;

  const eligible = payload.rows.filter((r) => r.amplitude >= PUSH_MIN_AMPLITUDE);
  if (eligible.length === 0) return `${head}\n\n${s.empty}`;

  const longs = eligible.filter((r) => r.direction === "long");
  const shorts = eligible.filter((r) => r.direction === "short");

  return [
    head,
    "",
    formatScannerGroup("long", longs, settings, lang),
    "",
    formatScannerGroup("short", shorts, settings, lang),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Whether enough time has passed since the last *successful* push.
 *
 * Gating in application code rather than in the cron expression is what makes
 * a missed run self-healing: the schedule ticks far more often than the
 * interval, so if one tick dies (timeout, cold start, Telegram outage) the
 * next tick still sees "overdue" and pushes. It also lets an admin change the
 * interval from the UI without editing pg_cron.
 */
export function isPushDue(
  lastPushedAt: string | null,
  intervalMinutes: number,
  now: number = Date.now()
): boolean {
  if (!lastPushedAt) return true;
  const last = new Date(lastPushedAt).getTime();
  if (!Number.isFinite(last)) return true;
  // A clock skew that puts the last push in the future shouldn't wedge pushes
  // shut forever; treat it as due.
  if (last > now) return true;
  return now - last >= intervalMinutes * 60_000;
}

export interface TargetDeliveryResult {
  targetId: string;
  label: string;
  chatId: string;
  messageThreadId: number | null;
  ok: boolean;
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface PushOutcome {
  /** True when at least one target accepted the message. */
  delivered: boolean;
  skippedReason?: "disabled" | "not_due" | "no_targets" | "no_token";
  results: TargetDeliveryResult[];
  lastPushedAt: string | null;
}

async function recordDelivery(
  result: TargetDeliveryResult,
  trigger: PushTrigger
): Promise<void> {
  const client = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  // Health on the target itself, so the admin list can flag a chat that has
  // been failing without digging through logs.
  if (result.ok) {
    await client
      .from("telegram_push_targets")
      .update({ last_ok_at: nowIso, consecutive_failures: 0, last_error: null })
      .eq("id", result.targetId);
  } else {
    // Incrementing in SQL rather than read-modify-write here: two overlapping
    // runs would otherwise both read the same count and write the same +1.
    await client.rpc("increment_telegram_target_failure", {
      p_target_id: result.targetId,
      p_error: (result.error ?? "unknown").slice(0, 1000),
    });
  }

  await client.from("telegram_push_log").insert({
    target_id: result.targetId,
    target_label: result.label,
    chat_id: result.chatId,
    // Without this, two topics in the same group are indistinguishable in the
    // log — "which topic failed" would be guesswork.
    message_thread_id: result.messageThreadId,
    status: result.ok ? "ok" : "failed",
    error: result.ok ? null : (result.error ?? "unknown").slice(0, 1000),
    attempts: result.attempts,
    duration_ms: result.durationMs,
    trigger,
  });
}

/**
 * Fan out one message to every enabled target.
 *
 * Targets are delivered independently and failures are recorded, never thrown —
 * one chat the bot was kicked from must not stop the rest, which is exactly how
 * the previous single-destination implementation lost whole pushes.
 */
export async function deliverToTargets(
  settings: TelegramPushSettings,
  targets: TelegramTarget[],
  buildText: (lang: TelegramMessageLang) => string,
  trigger: PushTrigger,
  /** Transport overrides. The briefing tightens these because it runs on the
   *  tail end of an already-spent wall-clock budget. */
  sendOpts: Omit<TelegramSendOptions, "messageThreadId"> = {}
): Promise<TargetDeliveryResult[]> {
  const active = targets.filter((t) => t.enabled);

  // Message text only depends on language, so build at most one per language
  // rather than re-formatting the whole screener payload per target.
  const textByLang = new Map<TelegramMessageLang, string>();
  const textFor = (lang: TelegramMessageLang) => {
    let cached = textByLang.get(lang);
    if (cached === undefined) {
      cached = buildText(lang);
      textByLang.set(lang, cached);
    }
    return cached;
  };

  const results = await Promise.all(
    active.map(async (target): Promise<TargetDeliveryResult> => {
      const token = target.botToken ?? settings.botToken;
      if (!token) {
        return {
          targetId: target.id,
          label: target.label,
          chatId: target.chatId,
          messageThreadId: target.messageThreadId,
          ok: false,
          attempts: 0,
          durationMs: 0,
          error: "No bot token configured for this target",
        };
      }
      const lang = target.messageLang ?? settings.messageLang;
      const sent: TelegramSendResult = await sendTelegramMessage(token, target.chatId, textFor(lang), {
        ...sendOpts,
        messageThreadId: target.messageThreadId,
      });
      return {
        targetId: target.id,
        label: target.label,
        chatId: target.chatId,
        messageThreadId: target.messageThreadId,
        ok: sent.ok,
        attempts: sent.attempts,
        durationMs: sent.durationMs,
        error: sent.error,
      };
    })
  );

  // Recording is best-effort: losing a log row must not turn a delivered push
  // into a reported failure.
  await Promise.all(
    results.map((r) =>
      recordDelivery(r, trigger).catch((err) =>
        console.error("[telegram-push] failed to record delivery", err)
      )
    )
  );

  return results;
}

async function markAttempt(delivered: boolean, error: string | null): Promise<string | null> {
  const client = createServiceRoleClient();
  const nowIso = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { last_attempt_at: nowIso };
  if (delivered) {
    patch.last_pushed_at = nowIso;
    patch.last_error = null;
    patch.consecutive_failures = 0;
  } else {
    patch.last_error = error;
  }
  await client.from("telegram_push_settings").update(patch).eq("id", 1);

  if (!delivered) {
    // Same read-modify-write concern as per-target failures.
    await client.rpc("increment_telegram_settings_failure", { p_error: error ?? "unknown" });
  }
  return delivered ? nowIso : null;
}

/**
 * Called by the cron. Honours the enabled flag and the configured interval,
 * and reports why it did nothing so the caller can log something useful.
 */
export async function pushScreenerToTelegram(
  payload: ScannerPayload,
  opts: { force?: boolean; trigger?: PushTrigger } = {}
): Promise<PushOutcome> {
  const trigger = opts.trigger ?? "cron";
  const settings = await getTelegramPushSettings();

  if (!opts.force && !settings.enabled) {
    return { delivered: false, skippedReason: "disabled", results: [], lastPushedAt: settings.lastPushedAt };
  }
  if (!opts.force && !isPushDue(settings.lastPushedAt, settings.pushIntervalMinutes)) {
    return { delivered: false, skippedReason: "not_due", results: [], lastPushedAt: settings.lastPushedAt };
  }

  // Only the destinations subscribed to the screener. A group that exists purely
  // to receive the daily briefing link must not get a screener table every 4h.
  const targets = await listTargetsFor("screener");
  if (targets.length === 0) {
    return { delivered: false, skippedReason: "no_targets", results: [], lastPushedAt: settings.lastPushedAt };
  }
  if (!settings.botToken && targets.every((t) => !t.botToken)) {
    return { delivered: false, skippedReason: "no_token", results: [], lastPushedAt: settings.lastPushedAt };
  }

  const results = await deliverToTargets(
    settings,
    targets,
    (lang) => formatScannerMessage(payload, settings, lang),
    trigger
  );

  const delivered = results.some((r) => r.ok);
  const failedSummary = results
    .filter((r) => !r.ok)
    .map((r) => `${r.label}: ${r.error ?? "unknown"}`)
    .join("; ");

  const lastPushedAt = await markAttempt(delivered, failedSummary ? failedSummary.slice(0, 1000) : null);

  return {
    delivered,
    results,
    lastPushedAt: lastPushedAt ?? settings.lastPushedAt,
  };
}

/**
 * Admin-triggered "push now" — bypasses both the `enabled` flag and the
 * interval, since an explicit click is explicit intent.
 */
export async function pushScreenerNow(): Promise<PushOutcome> {
  const payload = await getScannerPayload();
  return pushScreenerToTelegram(payload, { force: true, trigger: "manual" });
}

/** Send a one-off test message to a single target (or all, when no id is given). */
export async function sendTelegramTest(targetId?: string): Promise<TargetDeliveryResult[]> {
  const settings = await getTelegramPushSettings();
  const all = await listTelegramTargets();
  const targets = targetId ? all.filter((t) => t.id === targetId) : all.filter((t) => t.enabled);

  if (targets.length === 0) throw new Error("no_targets");

  return deliverToTargets(
    settings,
    // A test fires at the chosen target even if it is currently switched off —
    // that's usually exactly the one being debugged.
    targets.map((t) => ({ ...t, enabled: true })),
    (lang) =>
      lang === "zh"
        ? "✅ Chart-IX 测试消息 — 这条消息说明 Bot 配置正确。"
        : "✅ Chart-IX test message — your bot is wired up correctly.",
    "test"
  );
}

export { sendTelegramMessage } from "@/lib/telegram-send";
