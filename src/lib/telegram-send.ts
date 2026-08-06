/**
 * Low-level Telegram Bot API transport.
 *
 * Split out of telegram-push.ts so the delivery mechanics (timeout, retry,
 * rate-limit handling) are testable without touching the database.
 *
 * This is where the "推送卡断后就不推了" bug lived: the old implementation
 * called fetch() with no AbortSignal, so a hung connection to api.telegram.org
 * held the serverless function until the platform killed it at maxDuration.
 * That killed the whole cron invocation, and the next scheduled attempt was a
 * full interval away — one hang meant hours of silence.
 */

/** Per-attempt ceiling. Telegram normally answers in well under a second. */
export const TELEGRAM_TIMEOUT_MS = 10_000;
/** Total attempts per message, including the first. */
export const TELEGRAM_MAX_ATTEMPTS = 3;
/** Base for exponential backoff between attempts. */
export const TELEGRAM_BACKOFF_MS = 500;

export interface TelegramSendResult {
  ok: boolean;
  attempts: number;
  durationMs: number;
  error?: string;
}

export class TelegramError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null when the request never got a response. */
    readonly status: number | null,
    /** Telegram's `parameters.retry_after` (seconds) on 429. */
    readonly retryAfterSec: number | null,
    /** False for 4xx that will never succeed on retry (bad token, bad chat id). */
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

/**
 * 4xx other than 429 means the request itself is wrong — a bad token, a chat the
 * bot was kicked from, a malformed chat id. Retrying just burns the budget and
 * delays the targets that *would* have worked.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/** Exposed for tests; callers use sendTelegramMessage. */
export function backoffDelayMs(attempt: number, retryAfterSec: number | null): number {
  // Telegram's own retry_after wins — it knows when the flood limit clears.
  if (retryAfterSec !== null && retryAfterSec >= 0) return retryAfterSec * 1000;
  return TELEGRAM_BACKOFF_MS * Math.pow(2, attempt - 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attemptSend(
  botToken: string,
  chatId: string,
  text: string,
  timeoutMs: number
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      // The fix for the hang: bound every attempt so a dead connection can
      // never hold the whole function hostage.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // AbortError (timeout) and network failures are both worth retrying.
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    throw new TelegramError(
      isTimeout ? `Timed out after ${timeoutMs}ms` : `Network error: ${String(err)}`,
      null,
      null,
      true
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let retryAfterSec: number | null = null;
    try {
      const parsed = JSON.parse(body);
      const ra = parsed?.parameters?.retry_after;
      if (typeof ra === "number") retryAfterSec = ra;
    } catch {
      // Non-JSON error body (e.g. an upstream proxy's HTML) — nothing to extract.
    }
    throw new TelegramError(
      `Telegram API responded ${res.status}: ${body.slice(0, 300)}`,
      res.status,
      retryAfterSec,
      isRetryableStatus(res.status)
    );
  }

  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    // 200 with ok:false is Telegram reporting a logical failure; not retryable.
    throw new TelegramError(
      `Telegram API error: ${json?.description ?? "unknown"}`,
      200,
      null,
      false
    );
  }
}

/**
 * Send one message, retrying transient failures with backoff.
 *
 * Never throws — returns a result the caller records per target, so one dead
 * chat can't abort delivery to the others.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  opts: { maxAttempts?: number; timeoutMs?: number } = {}
): Promise<TelegramSendResult> {
  const maxAttempts = opts.maxAttempts ?? TELEGRAM_MAX_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
  const startedAt = Date.now();

  let lastError = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await attemptSend(botToken, chatId, text, timeoutMs);
      return { ok: true, attempts: attempt, durationMs: Date.now() - startedAt };
    } catch (err) {
      const tgErr = err instanceof TelegramError ? err : null;
      lastError = err instanceof Error ? err.message : String(err);

      const retryable = tgErr?.retryable ?? false;
      if (!retryable || attempt === maxAttempts) {
        return {
          ok: false,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          error: lastError,
        };
      }

      await sleep(backoffDelayMs(attempt, tgErr?.retryAfterSec ?? null));
    }
  }

  // Unreachable — the loop always returns — but keeps the type total.
  return { ok: false, attempts: maxAttempts, durationMs: Date.now() - startedAt, error: lastError };
}
