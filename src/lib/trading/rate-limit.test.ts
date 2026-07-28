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
});
