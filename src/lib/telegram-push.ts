import { encrypt, decrypt } from "@/lib/crypto";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import type { ScreenerPayload } from "@/lib/screener-server";
import type { ScreenerResult, Direction } from "@/lib/screener-scoring";

export interface TelegramPushSettings {
  enabled: boolean;
  /** Decrypted; null when never configured */
  botToken: string | null;
  chatId: string | null;
  showPrice: boolean;
  showChange24h: boolean;
  showAmplitude: boolean;
  showMarketCap: boolean;
  showVolume: boolean;
  showOiRatio: boolean;
  showFunding: boolean;
  showScore: boolean;
  showEdge: boolean;
  lastPushedAt: string | null;
  updatedAt: string;
}

interface TelegramPushRow {
  enabled: boolean;
  bot_token_encrypted: string | null;
  chat_id: string | null;
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
  updated_at: string;
}

function rowToSettings(row: TelegramPushRow): TelegramPushSettings {
  return {
    enabled: row.enabled,
    botToken: row.bot_token_encrypted ? decrypt(row.bot_token_encrypted) : null,
    chatId: row.chat_id,
    showPrice: row.show_price,
    showChange24h: row.show_change_24h,
    showAmplitude: row.show_amplitude,
    showMarketCap: row.show_market_cap,
    showVolume: row.show_volume,
    showOiRatio: row.show_oi_ratio,
    showFunding: row.show_funding,
    showScore: row.show_score,
    showEdge: row.show_edge,
    lastPushedAt: row.last_pushed_at,
    updatedAt: row.updated_at,
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

export interface TelegramPushUpdate {
  enabled?: boolean;
  /** Pass to rotate the stored token; omit to leave it untouched. */
  botToken?: string;
  chatId?: string;
  showPrice?: boolean;
  showChange24h?: boolean;
  showAmplitude?: boolean;
  showMarketCap?: boolean;
  showVolume?: boolean;
  showOiRatio?: boolean;
  showFunding?: boolean;
  showScore?: boolean;
  showEdge?: boolean;
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
  if (update.chatId !== undefined) patch.chat_id = update.chatId.trim() || null;
  if (update.showPrice !== undefined) patch.show_price = update.showPrice;
  if (update.showChange24h !== undefined) patch.show_change_24h = update.showChange24h;
  if (update.showAmplitude !== undefined) patch.show_amplitude = update.showAmplitude;
  if (update.showMarketCap !== undefined) patch.show_market_cap = update.showMarketCap;
  if (update.showVolume !== undefined) patch.show_volume = update.showVolume;
  if (update.showOiRatio !== undefined) patch.show_oi_ratio = update.showOiRatio;
  if (update.showFunding !== undefined) patch.show_funding = update.showFunding;
  if (update.showScore !== undefined) patch.show_score = update.showScore;
  if (update.showEdge !== undefined) patch.show_edge = update.showEdge;

  const { data, error } = await client
    .from("telegram_push_settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to update telegram_push_settings");
  return rowToSettings(data as TelegramPushRow);
}

async function markPushed(): Promise<void> {
  const client = createServiceRoleClient();
  await client
    .from("telegram_push_settings")
    .update({ last_pushed_at: new Date().toISOString() })
    .eq("id", 1);
}

function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 });
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatRow(r: ScreenerResult, settings: TelegramPushSettings): string {
  const symbol = escapeHtml(r.symbol.replace("-USDT", ""));
  const extras: string[] = [];
  if (settings.showPrice) extras.push(`Price ${fmtPrice(r.lastPrice)}`);
  if (settings.showChange24h && r.priceChangePercent !== null) {
    extras.push(`24h ${fmtPercent(r.priceChangePercent)}`);
  }
  if (settings.showAmplitude) extras.push(`Amp ${r.amplitude.toFixed(1)}%`);
  if (settings.showMarketCap && r.marketCap !== null) {
    extras.push(`MCap $${(r.marketCap / 1_000_000).toFixed(1)}M`);
  }
  if (settings.showVolume) extras.push(`Vol $${(r.quoteVolume / 1_000_000).toFixed(1)}M`);
  if (settings.showOiRatio && r.oiVolumeRatio !== null) {
    extras.push(`OI/Vol ${r.oiVolumeRatio.toFixed(2)}`);
  }
  if (settings.showFunding) extras.push(`Funding ${fmtPercent(r.fundingRate * 100)}`);
  if (settings.showScore) extras.push(`Score ${r.score.toFixed(0)}`);
  if (settings.showEdge) extras.push(`Edge ${r.edge.toFixed(0)}`);

  return extras.length > 0 ? `<b>${symbol}</b> — ${extras.join(" · ")}` : `<b>${symbol}</b>`;
}

function formatGroup(direction: Direction, rows: ScreenerResult[], settings: TelegramPushSettings): string {
  const emoji = direction === "long" ? "🟢" : "🔴";
  const label = direction === "long" ? "做多 Long" : "做空 Short";
  if (rows.length === 0) return `${emoji} <b>${label}</b>\n(no candidates)`;
  const lines = rows.map((r, i) => `${i + 1}. ${formatRow(r, settings)}`);
  return `${emoji} <b>${label}</b>\n${lines.join("\n")}`;
}

export function formatScreenerMessage(
  payload: ScreenerPayload,
  settings: TelegramPushSettings
): string {
  const timestamp = new Date(payload.computedAt).toISOString().replace("T", " ").slice(0, 16);
  return [
    `📊 <b>Chart-IX 筛选器</b> · ${timestamp} UTC`,
    "",
    formatGroup("long", payload.long, settings),
    "",
    formatGroup("short", payload.short, settings),
  ].join("\n");
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram API responded ${res.status}: ${body}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram API error: ${json.description ?? "unknown"}`);
}

export async function pushScreenerToTelegram(payload: ScreenerPayload): Promise<void> {
  const settings = await getTelegramPushSettings();
  if (!settings.enabled || !settings.botToken || !settings.chatId) return;

  const text = formatScreenerMessage(payload, settings);
  await sendTelegramMessage(settings.botToken, settings.chatId, text);
  await markPushed();
}
