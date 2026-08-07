import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDecryptedApiKeys, invalidateApiKeys, __setDepsForTest } from "./api-key-cache";

describe("api-key-cache", () => {
  beforeEach(() => {
    __setDepsForTest({ fetcher: vi.fn(), now: () => 0 });
  });

  it("first call goes through the fetcher and caches the result", async () => {
    const fetcher = vi.fn().mockResolvedValue({ apiKey: "key-1", secret: "secret-1" });
    __setDepsForTest({ fetcher, now: () => 0 });

    const result = await getDecryptedApiKeys("user-1");

    expect(result).toEqual({ apiKey: "key-1", secret: "secret-1" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("user-1");
  });

  it("a second call within 60s does not hit the fetcher again", async () => {
    let clock = 0;
    const fetcher = vi.fn().mockResolvedValue({ apiKey: "key-1", secret: "secret-1" });
    __setDepsForTest({ fetcher, now: () => clock });

    await getDecryptedApiKeys("user-1");
    clock += 59_000; // still within the 60s TTL window
    const second = await getDecryptedApiKeys("user-1");

    expect(second).toEqual({ apiKey: "key-1", secret: "secret-1" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the TTL has expired", async () => {
    let clock = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ apiKey: "key-1", secret: "secret-1" })
      .mockResolvedValueOnce({ apiKey: "key-2", secret: "secret-2" });
    __setDepsForTest({ fetcher, now: () => clock });

    await getDecryptedApiKeys("user-1");
    clock += 60_000; // exactly at/over TTL — must recompute
    const second = await getDecryptedApiKeys("user-1");

    expect(second).toEqual({ apiKey: "key-2", secret: "secret-2" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces an immediate re-fetch on the next call", async () => {
    const clock = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ apiKey: "key-1", secret: "secret-1" })
      .mockResolvedValueOnce({ apiKey: "key-2", secret: "secret-2" });
    __setDepsForTest({ fetcher, now: () => clock });

    await getDecryptedApiKeys("user-1");
    invalidateApiKeys("user-1");
    const second = await getDecryptedApiKeys("user-1");

    expect(second).toEqual({ apiKey: "key-2", secret: "secret-2" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache a null (no keys) result — the next call re-fetches immediately", async () => {
    const clock = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ apiKey: "key-1", secret: "secret-1" });
    __setDepsForTest({ fetcher, now: () => clock });

    const first = await getDecryptedApiKeys("user-1");
    expect(first).toBeNull();

    const second = await getDecryptedApiKeys("user-1");
    expect(second).toEqual({ apiKey: "key-1", secret: "secret-1" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("caches different users independently", async () => {
    const clock = 0;
    const fetcher = vi.fn(async (userId: string) => ({ apiKey: `key-${userId}`, secret: `secret-${userId}` }));
    __setDepsForTest({ fetcher, now: () => clock });

    const a1 = await getDecryptedApiKeys("user-a");
    const b1 = await getDecryptedApiKeys("user-b");
    const a2 = await getDecryptedApiKeys("user-a");
    const b2 = await getDecryptedApiKeys("user-b");

    expect(a1).toEqual({ apiKey: "key-user-a", secret: "secret-user-a" });
    expect(b1).toEqual({ apiKey: "key-user-b", secret: "secret-user-b" });
    expect(a2).toEqual(a1);
    expect(b2).toEqual(b1);
    expect(fetcher).toHaveBeenCalledTimes(2); // one per user, not re-fetched for the other's call
  });
});
