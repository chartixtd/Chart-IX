import { describe, it, expect } from "vitest";
import { pickStaleCoins, VOLUME_REFRESH_BATCH } from "./volume-cache";
import type { CachedVolume } from "./volume-cache";

const cache = (entries: Array<[string, number]>): Map<string, CachedVolume> =>
  new Map(entries.map(([coin, updatedAt]) => [coin, { volumeUsd: 1, updatedAt }]));

describe("pickStaleCoins", () => {
  it("没缓存过的排在最前——否则新上市的币永远进不了榜单", () => {
    // 成交量门槛是「必须证明达标」，查不到缓存 = 证明不了 = 被挡掉。
    // 所以未缓存的币如果排不到刷新队列前面，它就会一直被挡着，
    // 而且这个卡死是完全静默的：榜单看起来正常，只是少了那个币。
    const picked = pickStaleCoins(["OLD", "NEW", "MID"], cache([["OLD", 100], ["MID", 200]]), 2);
    expect(picked[0]).toBe("NEW");
    expect(picked[1]).toBe("OLD");
  });

  it("其余按 updated_at 从旧到新", () => {
    const picked = pickStaleCoins(
      ["A", "B", "C"],
      cache([["A", 300], ["B", 100], ["C", 200]]),
      3
    );
    expect(picked).toEqual(["B", "C", "A"]);
  });

  it("时间戳相同时按币名排，保证结果可复现", () => {
    expect(pickStaleCoins(["C", "A", "B"], cache([["A", 5], ["B", 5], ["C", 5]]), 3)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("轮转必须覆盖全池：反复取走并刷新，每个币最终都会被刷到", () => {
    // 这条是整个轮转设计的正确性核心——只要存在「某些币永远排不上队」，
    // 它们就永远进不了榜单。用一次模拟跑完整轮把它钉死。
    const coins = Array.from({ length: 25 }, (_, i) => `C${i}`);
    const c = new Map<string, CachedVolume>();
    let clock = 1;
    const seen = new Set<string>();
    for (let round = 0; round < 10; round++) {
      for (const coin of pickStaleCoins(coins, c, 5)) {
        seen.add(coin);
        c.set(coin, { volumeUsd: 1, updatedAt: clock++ });
      }
    }
    expect(seen.size).toBe(coins.length);
  });

  it("limit 为 0 或负数时返回空，不抛错", () => {
    expect(pickStaleCoins(["A"], cache([]), 0)).toEqual([]);
    expect(pickStaleCoins(["A"], cache([]), -3)).toEqual([]);
  });

  it("一批的大小要能在一次函数调用里跑完，且不顶满每分钟配额", () => {
    // 刷新跑在 cron tick 上，和扫描共用同一个 CoinGlass key 的配额窗口。
    expect(VOLUME_REFRESH_BATCH).toBeLessThan(75);
  });
});
