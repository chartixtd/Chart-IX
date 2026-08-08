import { describe, it, expect, vi, afterEach } from "vitest";
import { translateText } from "./translate";

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
