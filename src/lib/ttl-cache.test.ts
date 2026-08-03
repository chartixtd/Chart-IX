import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

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

  it("recomputes once the clock has advanced past the TTL", async () => {
    let clock = 0;
    const compute = vi.fn(async () => `value-${clock}`);
    const cache = createTtlCache({ ttlMs: 1000, compute, now: () => clock });

    await cache.get();
    expect(compute).toHaveBeenCalledTimes(1);

    clock += 1000; // 恰好/超过 TTL，需要重新计算
    const second = await cache.get();
    expect(second).toBe("value-1000");
    expect(compute).toHaveBeenCalledTimes(2);
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
});
