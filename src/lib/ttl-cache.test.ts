import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

// 冲刷微任务队列——用真实的宏任务把所有已排队的 promise 回调走完
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createTtlCache", () => {
  it("peek() returns null before the first compute", () => {
    const cache = createTtlCache({ ttlMs: 1000, compute: async () => "data" });
    expect(cache.peek()).toBeNull();
  });

  it("triggers compute on first call, then serves from cache within the TTL window", async () => {
    let clock = 0;
    const compute = vi.fn(async () => "value");
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    const first = await cache.get();
    expect(first).toBe("value");
    expect(compute).toHaveBeenCalledTimes(1);

    clock += 500; // 仍在 TTL 窗口内
    const second = await cache.get();
    expect(second).toBe("value");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes once the clock has advanced past the TTL (stale-while-revalidate: old value first, new value after the background compute settles)", async () => {
    let clock = 0;
    const compute = vi.fn(async () => `value-${clock}`);
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    await cache.get();
    expect(compute).toHaveBeenCalledTimes(1);

    clock += 1000; // 恰好/超过 TTL，需要重新计算
    const second = await cache.get();
    expect(second).toBe("value-0"); // SWR：先吐旧值，重算在后台跑
    expect(compute).toHaveBeenCalledTimes(2); // 后台 compute 已经被触发

    await flush(); // 冲刷微任务，等后台 compute 落地
    const third = await cache.get();
    expect(third).toBe("value-1000");
    expect(compute).toHaveBeenCalledTimes(2); // 缓存已更新，不需要再算一次
  });

  it("coalesces concurrent misses into exactly one compute call", async () => {
    let resolveCompute: (value: string) => void;
    const compute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveCompute = resolve;
        })
    );
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => 0 });

    // 不 await，连续发起 5 次并发请求，全部应该搭上同一班 compute
    const promises = [cache.get(), cache.get(), cache.get(), cache.get(), cache.get()];

    expect(compute).toHaveBeenCalledTimes(1);

    resolveCompute!("shared-result");
    const results = await Promise.all(promises);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      "shared-result",
      "shared-result",
      "shared-result",
      "shared-result",
      "shared-result",
    ]);
  });

  it("rejects when compute fails and there is no previous value, then retries on the next call", async () => {
    const compute = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => 0 });

    await expect(cache.get()).rejects.toThrow("boom");
    expect(compute).toHaveBeenCalledTimes(1);

    // 失败不能被缓存——下一次调用必须重新尝试，而不是重放失败
    const second = await cache.get();
    expect(second).toBe("recovered");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("returns the stale value instead of throwing when compute fails but a previous value exists", async () => {
    let clock = 0;
    const compute = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("upstream hiccup"));
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    const first = await cache.get();
    expect(first).toBe("first");

    clock += 1000; // 过期，触发重新计算，这次会失败
    const second = await cache.get();
    expect(second).toBe("first"); // stale-while-error：不抛错，用旧值顶着
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("SWR ①: when stale and a previous value exists, get() returns the old value immediately and kicks off a background compute", async () => {
    let clock = 0;
    let resolveCompute: (value: string) => void;
    const compute = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveCompute = resolve;
          })
      );
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    await cache.get();
    expect(compute).toHaveBeenCalledTimes(1);

    clock += 1000; // 过期
    const stale = await cache.get();
    expect(stale).toBe("first"); // 立即拿到旧值，不等后台算完
    expect(compute).toHaveBeenCalledTimes(2); // 后台 compute 已经触发

    resolveCompute!("second"); // 收尾，避免悬挂的 promise 影响后续用例
    await flush();
  });

  it("SWR ②: once the background compute settles, the next get() returns the new value", async () => {
    let clock = 0;
    const compute = vi.fn(async () => `value-${clock}`);
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    await cache.get();
    clock += 1000;

    const stale = await cache.get();
    expect(stale).toBe("value-0");

    await flush(); // 让后台 compute 落地

    const fresh = await cache.get();
    expect(fresh).toBe("value-1000");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("SWR ③: a failing background compute keeps the old value and does not throw", async () => {
    let clock = 0;
    const compute = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("background hiccup"));
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    await cache.get();
    clock += 1000;

    await expect(cache.get()).resolves.toBe("first"); // 不抛
    await flush(); // 让失败的后台 compute 落地（应该被内部吞掉，不产生未处理拒绝）

    expect(cache.peek()?.data).toBe("first"); // 旧值原封不动地保留
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("SWR ④: concurrent get() calls on a stale cache trigger only one background compute", async () => {
    let clock = 0;
    let resolveCompute: (value: string) => void;
    const compute = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveCompute = resolve;
          })
      );
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    await cache.get();
    clock += 1000; // 过期

    const results = await Promise.all([cache.get(), cache.get(), cache.get(), cache.get(), cache.get()]);
    expect(results).toEqual(["first", "first", "first", "first", "first"]);
    expect(compute).toHaveBeenCalledTimes(2); // 5 次并发过期请求只触发 1 次后台 compute

    resolveCompute!("second");
    await flush();
  });
});
