import { encrypt, decrypt } from "@/lib/crypto";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  sendTelegramMessage,
  type TelegramSendOptions,
  type TelegramSendResult,
} from "@/lib/telegram-send";

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
}


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

/** Telegram's HTML parse_mode only needs these three escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/*
 * 这里曾经住着整套**榜单**消息的格式化：MESSAGE_STRINGS、场景名表、
 * formatScannerRow / formatScannerGroup / formatScannerMessage，以及一组
 * show* 展示开关（价格、24h、振幅、市值、成交量、方向、费率、总分、因子）。
 *
 * T25 全部删除。scanner 的 Telegram 推送从「每 4 小时发一张排行榜」改成
 * 「扫描出新警报卡就发那几张卡」——榜单本身仍然在网页上，但它不再是一条
 * 推送内容，那么为它维护一套跨三语的表格排版和九个列开关就没有对应的产出了。
 *
 * telegram_push_settings 上的 show_* 列**没有删**，跟 chat_id 一样留作回滚，
 * 只是 TS 这一侧不再读写它们。要恢复榜单推送，翻 git 比重写便宜。
 */

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/*
 * 这里曾经有 isPushDue —— 「距上次成功推送够不够 N 分钟」。
 *
 * 它是**时间驱动**留下的最后一块：先是榜单每 4 小时发一次的定时器，榜单删掉
 * 后被留成警报推送的「最小间隔」节流闸。两者是同一件事换了个名字：够不够钟
 * 仍然由时钟说了算，一条刚触发的警报会被压到下一个窗口——而警报的全部价值
 * 就在时效上。现在推送完全由「扫描产出了新卡片」这个事件驱动，没有任何一处
 * 再需要问「现在几点」。
 *
 * telegram_push_settings.push_interval_minutes 这一列没删（见 054 迁移），
 * 跟 chat_id、show_* 一样留作回滚。
 */

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

/**
 * 把一次推送尝试记进 telegram_push_settings 的健康字段。
 *
 * 从私有改成导出：榜单推送删掉之后，唯一会真正发消息的调用方是
 * screener/alert-push.ts，而后台那张健康卡（上次推送时间、连续失败次数、
 * 最后一条错误）读的就是这几列。不记的话，后台会永远显示「从未推送」，
 * 而机器人其实一直在发——一个永远绿或永远灰的健康指示等于没有。
 *
 * last_pushed_at 同时是节流闸的基准（见 isPushDue 与 pushIntervalMinutes），
 * 所以它必须只在**投递成功**时前进，失败不能顶掉下一次的机会。
 */
export async function markPushAttempt(
  delivered: boolean,
  error: string | null
): Promise<string | null> {
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
