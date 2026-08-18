import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coinglassGet, runWithConcurrency, CoinGlassError, RollingWindowLimiter } from "./client";

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

/** 依次返回不同响应，用来测多次 fetch 调用（比如 429 重试）的场景 */
function mockFetchSequence(bodies: unknown[]) {
  const fn = vi.fn();
  for (const body of bodies) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
  }
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  process.env.COINGLASS_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("coinglassGet", () => {
  it("剥掉信封只返回 data", async () => {
    mockFetchOnce({ code: "0", data: [{ a: 1 }] });
    await expect(coinglassGet("/api/futures/supported-coins")).resolves.toEqual([{ a: 1 }]);
  });

  it("把 code!==0 归一成 CoinGlassError 而不是当成正常返回", async () => {
    mockFetchOnce({ code: "401", msg: "Upgrade plan" });
    await expect(coinglassGet("/api/futures/coins-markets")).rejects.toBeInstanceOf(CoinGlassError);
  });

  it("缺少 API key 时立刻抛错，而不是让上游返回一个含义不明的 401", async () => {
    delete process.env.COINGLASS_API_KEY;
    mockFetchOnce({ code: "0", data: [] });
    await expect(coinglassGet("/api/futures/supported-coins")).rejects.toThrow(/COINGLASS_API_KEY/);
  });

  it("把 key 放进 CG-API-KEY 头，而不是查询串", async () => {
    mockFetchOnce({ code: "0", data: [] });
    await coinglassGet("/api/futures/supported-coins");
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["CG-API-KEY"]).toBe("test-key");
  });

  it("把数字参数序列化进查询串", async () => {
    mockFetchOnce({ code: "0", data: [] });
    await coinglassGet("/api/futures/price/history", { symbol: "BTCUSDT", limit: 336 });
    const [url] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("symbol=BTCUSDT");
    expect(String(url)).toContain("limit=336");
  });
});

describe("RollingWindowLimiter", () => {
  it("超过 limit 时等待而不是抛错", async () => {
    const limiter = new RollingWindowLimiter(2, 100);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    // 第三次已经用满窗口内的名额，必须等待——不能抛错、也不能无视窗口直接放行
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it("窗口滑出后名额会恢复，不会永久卡死", async () => {
    const limiter = new RollingWindowLimiter(1, 50);
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("coinglassGet 的 429 处理", () => {
  it("code: \"429\" 会等待后重试一次，重试成功则正常返回", async () => {
    vi.useFakeTimers();
    mockFetchSequence([
      { code: "429", msg: "Too many requests" },
      { code: "0", data: [1, 2, 3] },
    ]);
    const promise = coinglassGet("/api/futures/pairs-markets", { symbol: "BTC" });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual([1, 2, 3]);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("重试后仍是 429 就抛 CoinGlassError，而不是无限重试", async () => {
    vi.useFakeTimers();
    mockFetchSequence([
      { code: "429", msg: "Too many requests" },
      { code: "429", msg: "Too many requests" },
    ]);
    const promise = coinglassGet("/api/futures/pairs-markets", { symbol: "BTC" });
    const assertion = expect(promise).rejects.toBeInstanceOf(CoinGlassError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe("runWithConcurrency", () => {
  it("单个任务失败只让该位置变 null，不带倒整批", async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error("boom");
      },
      async () => 3,
    ];
    await expect(runWithConcurrency(tasks, 2)).resolves.toEqual([1, null, 3]);
  });

  it("同时在飞的任务数不超过 limit", async () => {
    let inflight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return 1;
    });
    await runWithConcurrency(tasks, 4);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("保持结果顺序与任务顺序一致", async () => {
    const tasks = [
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "slow";
      },
      async () => "fast",
    ];
    await expect(runWithConcurrency(tasks, 2)).resolves.toEqual(["slow", "fast"]);
  });
});
