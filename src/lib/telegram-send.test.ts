import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sendTelegramMessage,
  isRetryableStatus,
  backoffDelayMs,
  TELEGRAM_BACKOFF_MS,
} from "./telegram-send";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function okResponse() {
  return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
}
function errResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

describe("isRetryableStatus", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
  });

  it("does not retry 4xx that can never succeed", () => {
    // 401 = bad bot token, 400 = bad chat id, 403 = bot kicked from the chat.
    // Retrying these just delays the targets that would have worked.
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially when Telegram gives no hint", () => {
    expect(backoffDelayMs(1, null)).toBe(TELEGRAM_BACKOFF_MS);
    expect(backoffDelayMs(2, null)).toBe(TELEGRAM_BACKOFF_MS * 2);
    expect(backoffDelayMs(3, null)).toBe(TELEGRAM_BACKOFF_MS * 4);
  });

  it("obeys Telegram's retry_after over its own backoff", () => {
    // Telegram knows when its flood limit clears; guessing shorter gets us
    // limited again, guessing longer wastes the window.
    expect(backoffDelayMs(1, 7)).toBe(7000);
    expect(backoffDelayMs(3, 2)).toBe(2000);
  });

  it("treats retry_after 0 as an explicit 'immediately'", () => {
    expect(backoffDelayMs(2, 0)).toBe(0);
  });
});

describe("sendTelegramMessage", () => {
  it("returns ok on first success without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTelegramMessage("tok", "-100", "hi");
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 and succeeds on the second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500, { ok: false }))
      .mockResolvedValueOnce(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTelegramMessage("tok", "-100", "hi", { maxAttempts: 3 });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("gives up immediately on a non-retryable 401 — a bad token never fixes itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(401, { ok: false, description: "Unauthorized" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTelegramMessage("bad", "-100", "hi", { maxAttempts: 3 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toContain("401");
  });

  it("stops after maxAttempts on persistent 5xx and reports the failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(503, { ok: false }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTelegramMessage("tok", "-100", "hi", { maxAttempts: 2 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws — a dead chat must not abort delivery to other targets", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    await expect(sendTelegramMessage("tok", "-100", "hi", { maxAttempts: 1 })).resolves.toMatchObject({
      ok: false,
    });
  });

  it("treats HTTP 200 with ok:false as a final failure, not a retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTelegramMessage("tok", "-100", "hi", { maxAttempts: 3 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain("chat not found");
  });

  it("passes an abort signal so a hung connection can't stall the run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramMessage("tok", "-100", "hi", { timeoutMs: 1234 });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits message_thread_id entirely when no topic is set", async () => {
    // Sending an explicit null gets rejected with "message thread not found"
    // instead of falling back to the chat's General topic — every pre-topic
    // destination would break.
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramMessage("tok", "-100", "hi");

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect("message_thread_id" in body).toBe(false);
    expect(body.disable_web_page_preview).toBe(true);
  });

  it("posts into the given forum topic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramMessage("tok", "-100", "hi", { messageThreadId: 42 });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.message_thread_id).toBe(42);
    expect(body.chat_id).toBe("-100");
  });

  it("keeps the topic across retries so a retried message lands in the same thread", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500, { ok: false }))
      .mockResolvedValueOnce(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramMessage("tok", "-100", "hi", { messageThreadId: 7, maxAttempts: 2 });

    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse((call[1] as RequestInit).body as string).message_thread_id).toBe(7);
    }
  });

  it("can enable the link preview — an article push is a link, not a table", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramMessage("tok", "-100", "hi", { disableWebPagePreview: false });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.disable_web_page_preview).toBe(false);
  });

  it("surfaces a timeout as a failed result rather than hanging", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      return Promise.reject(e);
    }) as unknown as typeof fetch;

    const result = await sendTelegramMessage("tok", "-100", "hi", { maxAttempts: 1, timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Timed out");
  });
});
