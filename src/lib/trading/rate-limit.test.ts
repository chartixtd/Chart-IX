import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, clearRateLimitState } from "./rate-limit";

const cfg = { windowMs: 1000, max: 3 };

beforeEach(() => clearRateLimitState());

describe("checkRateLimit", () => {
  it("allows requests up to the max within a window", () => {
    expect(checkRateLimit("u1", cfg, 0).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 100).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 200).ok).toBe(true);
  });

  it("blocks the request that exceeds the max", () => {
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 100);
    checkRateLimit("u1", cfg, 200);
    const r = checkRateLimit("u1", cfg, 300);
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(700);
  });

  it("lets the window slide so old hits expire", () => {
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 100);
    checkRateLimit("u1", cfg, 200);
    expect(checkRateLimit("u1", cfg, 1001).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 0);
    checkRateLimit("u1", cfg, 0);
    expect(checkRateLimit("u1", cfg, 0).ok).toBe(false);
    expect(checkRateLimit("u2", cfg, 0).ok).toBe(true);
  });

  it("does not count blocked requests against the window", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("u1", cfg, 0);
    // 窗口滑过后应恰好重新放行 max 次
    expect(checkRateLimit("u1", cfg, 1001).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 1002).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 1003).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 1004).ok).toBe(false);
  });

  it("blocks new requests based only on allowed hits, not blocked ones (with spread timestamps)", () => {
    // Timestamps must be spread across the window so that blocked vs allowed recording
    // produces observable differences. This test would fail under a buggy implementation
    // that records blocked hits, because the flood would fill the window with blocked
    // timestamps that persist (wrongly) after the allowed hits age out.

    // Three allowed hits spread in the window
    expect(checkRateLimit("u1", cfg, 0).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 100).ok).toBe(true);
    expect(checkRateLimit("u1", cfg, 200).ok).toBe(true);

    // Flood of blocked calls at increasing timestamps still in the window
    expect(checkRateLimit("u1", cfg, 300).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 350).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 400).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 450).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 500).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 550).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 600).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 700).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 800).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 900).ok).toBe(false);
    expect(checkRateLimit("u1", cfg, 950).ok).toBe(false);

    // After the oldest allowed hit ages out, a new request should be allowed
    // (cutoff = 1000 - 1000 = 0; only hits > 0 remain, which are 100, 200;
    // 2 < max of 3, so new request is allowed)
    const r = checkRateLimit("u1", cfg, 1000);
    expect(r.ok).toBe(true);
  });

  it("returns finite retryAfterMs for max: 0 (all requests blocked)", () => {
    const r = checkRateLimit("k", { windowMs: 1000, max: 0 }, 0);
    expect(r.ok).toBe(false);
    expect(Number.isFinite(r.retryAfterMs)).toBe(true);
    expect(r.retryAfterMs).toBeGreaterThanOrEqual(0);
  });
});
