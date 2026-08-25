import { describe, it, expect, vi, afterEach } from "vitest";
import { translateText, translateTextDetailed } from "./translate";

/**
 * 这里只测「请求被超时约束住」这一件事。
 *
 * 原实现的 fetch 不带 AbortSignal，undici 的默认 header/body 超时是 300 秒，
 * 而早报的 L3 会并发打 15-20 个请求：一次挂起就能吃光整个 serverless 函数，
 * 绕过 L4 兜底稿（无 insert、无心跳、无告警）。后台文章翻译器走同一个函数。
 */

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function okResponse() {
  return new Response(JSON.stringify([[["hello", "你好", null, null, 10]]]), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translateText", () => {
  // gtx 端点会把撇号/引号编成 &#39; / &quot; 返回。不解码的话，下游
  // renderBriefingHtml 的 escapeHtml 会把 & 再转义成 &amp;，页面上直接显示
  // "Fed&#39;s"。稳定性审查第 10 号发现。
  it("解码返回值里的 HTML 实体，Fed&#39;s 不会原样上页面", async () => {
    const body = JSON.stringify([[["Fed&#39;s stance on &quot;inflation&quot;", "原文", null, null, 10]]]);
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchFn>(async () => new Response(body, { status: 200 }))
    );

    const out = await translateText("美联储的立场", "zh", "en");

    expect(out).toBe("Fed's stance on \"inflation\"");
  });


  it("给 fetch 带上 AbortSignal，不再让挂住的连接无限期占着函数", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await translateText("你好", "zh", "en");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // 发起时当然还没中止——中止是 5 秒后的事
    expect(init?.signal?.aborted).toBe(false);
  });

  it("正常返回时仍然吐出译文（超时参数没有改变既有行为）", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchFn>(async () => okResponse()));
    expect(await translateText("你好", "zh", "en")).toBe("hello");
  });

  it("超时中止时返回 null，调用方按翻译失败处理", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchFn>(async () => {
        throw new DOMException("The operation was aborted", "TimeoutError");
      })
    );
    expect(await translateText("你好", "zh", "en")).toBeNull();
  });

  it("非 2xx 返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchFn>(async () => new Response("rate limited", { status: 429 })));
    expect(await translateText("你好", "zh", "en")).toBeNull();
  });
});

/**
 * 失败原因必须能落进诊断。
 *
 * 早报英文版曾连着降级成兜底稿，而运行记录里只有一句「翻译失败」——端点被封
 * （429 拦截页）、超时、返回体形状变了，三种处置完全不同的故障长得一模一样，
 * 每次排查都得从头猜。gtx 无鉴权、对数据中心 IP 段整体拦截，429 是这里最常见
 * 的一种，必须一眼认得出来。
 */
describe("translateTextDetailed", () => {
  type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

  it("非 2xx 时带上状态码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchStub>(async () => new Response("<html>Sorry...</html>", { status: 429 }))
    );
    const out = await translateTextDetailed("你好", "zh", "en");
    expect(out).toEqual({ ok: false, reason: "HTTP 429" });
  });

  it("超时时带上错误名，区别于「端点回了但内容不对」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchStub>(async () => {
        throw new DOMException("The operation was aborted", "TimeoutError");
      })
    );
    const out = await translateTextDetailed("你好", "zh", "en");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("TimeoutError");
  });

  it("返回体形状变了时说清是形状问题，而不是笼统的失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchStub>(async () => new Response(JSON.stringify({ error: "nope" }), { status: 200 }))
    );
    const out = await translateTextDetailed("你好", "zh", "en");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("形状");
  });

  it("成功时给出译文", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchStub>(async () => new Response(JSON.stringify([[["hello", "你好", null, null, 10]]]), { status: 200 }))
    );
    expect(await translateTextDetailed("你好", "zh", "en")).toEqual({ ok: true, text: "hello" });
  });
});
