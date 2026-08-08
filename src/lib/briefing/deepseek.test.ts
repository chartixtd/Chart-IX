import { describe, it, expect, vi, afterEach } from "vitest";
import { callDeepSeek, DEFAULT_TIMEOUT_MS } from "./deepseek";
import { buildBriefingPrompt } from "./prompt";
import type { BriefingSource, MarketFact } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OK_BODY = {
  choices: [{ message: { content: '{"title":"t"}' }, finish_reason: "stop" }],
};
// DeepSeek 文档明示会偶发空内容
const EMPTY_BODY = {
  choices: [{ message: { content: "" }, finish_reason: "stop" }],
};
const TRUNCATED_BODY = {
  choices: [{ message: { content: '{"title":"t' }, finish_reason: "length" }],
};

const BASE = { apiKey: "k", model: "deepseek-v4-flash", prompt: "p" };

describe("callDeepSeek", () => {
  it("正常响应返回内容与 finish_reason", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, content: '{"title":"t"}', finishReason: "stop" });
  });

  it("请求体带 json 模式与模型名", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("Authorization 头带 Bearer key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
  });

  it("空内容判为失败，交由调用方重试", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(EMPTY_BODY));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
  });

  it("截断响应仍返回内容，但 finishReason 为 length（交给质量门槛判定）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(TRUNCATED_BODY));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, finishReason: "length" });
  });

  it("HTTP 非 2xx 判为失败并带状态码", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 429));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("429");
  });

  it("网络异常不抛出，返回失败结果", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("boom");
  });

  it("choices 为空判为失败", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ choices: [] }));
    const r = await callDeepSeek({ ...BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
  });
});

// 超时/abort 分支此前零覆盖。它是 C2 的核心：单次调用必须在预算内被掐掉，
// 否则三次串行尝试会越过路由 maxDuration=60（Vercel Hobby 的套餐上限），
// 被平台掐断时整套降级阶梯都够不着。
describe("callDeepSeek — 超时与 abort", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 模拟一个永不返回、只在收到 abort 信号时才 reject 的请求 */
  function hangingFetch() {
    return vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
    );
  }

  it("超过 timeoutMs 会 abort 请求并归一成失败结果，而不是挂住", async () => {
    vi.useFakeTimers();
    const fetchImpl = hangingFetch();
    const p = callDeepSeek({
      ...BASE,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("aborted");
    const signal = (fetchImpl.mock.calls[0][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(true);
  });

  it("未到 timeoutMs 前不会 abort", async () => {
    vi.useFakeTimers();
    const fetchImpl = hangingFetch();
    void callDeepSeek({
      ...BASE,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(4_999);
    const signal = (fetchImpl.mock.calls[0][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(false);
  });

  // 这条原先断言的是「两次尝试要装进 60 秒」（上限 25 秒）。线上实测把那个前提
  // 证伪了：22 秒连**一次**生成都不够，每次调用都是 aborted，重试阶梯从未真正
  // 生效。真正的约束是「一次生成要装得下，且留得出落库的时间」，不是尝试次数。
  it("缺省超时要装得下一次完整生成，并给流水线其余步骤留出余量", () => {
    // 实测一次生成在 22 秒会被截断，所以下限必须显著高于它
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(25_000);
    // 承载路由 maxDuration=60（Vercel Hobby 上限），落库/推送/心跳还要时间
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(40_000);
  });
});

describe("buildBriefingPrompt", () => {
  const sources: BriefingSource[] = [
    { title: "Gold record", url: "https://e.com/a", source: "Investing.com", publishedAt: 1, summary: "s" },
  ];
  const facts: MarketFact[] = [
    { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  ];

  it("含 json 一词（DeepSeek JSON 模式的硬性要求）", () => {
    expect(buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08").toLowerCase()).toContain("json");
  });

  it("注入真实行情事实", () => {
    const p = buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08");
    expect(p).toContain("64959.52");
    expect(p).toContain("0.92");
  });

  it("注入新闻标题", () => {
    expect(buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08")).toContain("Gold record");
  });

  it("含禁止编造数字的约束", () => {
    expect(buildBriefingPrompt(sources, facts, "zh-CN", "2026-08-08")).toContain("不得");
  });

  it("英文 locale 要求以英文作答", () => {
    expect(buildBriefingPrompt(sources, facts, "en-US", "2026-08-08")).toContain("English");
  });

  it("行情为空时明确告知无行情数据，避免模型硬写", () => {
    const p = buildBriefingPrompt(sources, [], "zh-CN", "2026-08-08");
    expect(p).toContain("无行情数据");
  });
});
