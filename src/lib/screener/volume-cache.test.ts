import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Supabase 客户端的替身。`select` / `upsert` 各记一次调用，并按
 * `failOnPrice` 决定「带 price 的那次是否报 column does not exist」——
 * 这正是 migration 055 还没跑时线上发生的事。
 */
const selectCalls: string[] = [];
const upsertRows: Array<Record<string, unknown>[]> = [];
let failOnPrice = false;
let tableRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: (cols: string) => {
        selectCalls.push(cols);
        if (failOnPrice && cols.includes("price")) {
          return Promise.resolve({
            data: null,
            error: { message: 'column screener_volume_cache.price does not exist' },
          });
        }
        // 真实的 Postgres 只返回 select 里点名的列——stub 也必须这样，
        // 否则回退那条路径会拿到一个它在线上根本拿不到的 price。
        const projected = tableRows.map((r) => {
          const { price, ...rest } = r;
          return cols.includes("price") ? { ...rest, price } : rest;
        });
        return Promise.resolve({ data: projected, error: null });
      },
      upsert: (rows: Array<Record<string, unknown>>) => {
        upsertRows.push(rows);
        if (failOnPrice && rows.some((r) => "price" in r)) {
          return Promise.resolve({
            error: { message: 'column screener_volume_cache.price does not exist' },
          });
        }
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { pickStaleCoins, VOLUME_REFRESH_BATCH, readVolumeCache, upsertVolumes } = await import(
  "./volume-cache"
);
import type { CachedVolume } from "./volume-cache";

beforeEach(() => {
  selectCalls.length = 0;
  upsertRows.length = 0;
  failOnPrice = false;
  tableRows = [
    { coin: "BTC", volume_usd: 5e8, price: 77000, updated_at: "2026-09-14T00:00:00Z" },
    { coin: "XAU", volume_usd: 5.6e8, price: 4356, updated_at: "2026-09-14T00:00:00Z" },
  ];
});

/*
 * 这一组是踩出来的：撞名探测要的 `price` 列（migration 055）上线时，
 * 代码先部署、migration 还没跑，select 报 column does not exist，
 * 旧实现直接 catch 成空 Map —— 于是没有任何标的能证明成交量达标，
 * **三栏全空**，而表里 362 行数据好端端躺着，只是少一列。
 *
 * 一个只服务于可选错配探测的字段，不该有能力清空整个榜单。
 */
describe("price 列缺失时的降级", () => {
  it("读：退回不带 price 的读法，成交量照常可用", async () => {
    failOnPrice = true;
    const out = await readVolumeCache();
    expect(out.size).toBe(2);
    expect(out.get("XAU")?.volumeUsd).toBe(5.6e8);
    // price 读不到就是 null——那有明确语义：这一轮不做撞名探测
    expect(out.get("XAU")?.price).toBeNull();
    expect(selectCalls).toHaveLength(2);
    expect(selectCalls[0]).toContain("price");
    expect(selectCalls[1]).not.toContain("price");
  });

  it("读：列存在时只读一次，不做多余的回退查询", async () => {
    const out = await readVolumeCache();
    expect(out.get("XAU")?.price).toBe(4356);
    expect(selectCalls).toHaveLength(1);
  });

  it("写：退回不带 price 的写法，成交量照常刷新", async () => {
    failOnPrice = true;
    await upsertVolumes([{ coin: "XAU", volumeUsd: 5.6e8, price: 4356 }]);
    expect(upsertRows).toHaveLength(2);
    expect(upsertRows[0][0]).toHaveProperty("price");
    expect(upsertRows[1][0]).not.toHaveProperty("price");
    // updated_at 必须照写，否则这批下一跳仍然最旧、仍然被选中、仍然失败
    expect(upsertRows[1][0]).toHaveProperty("updated_at");
    expect(upsertRows[1][0].volume_usd).toBe(5.6e8);
  });

  it("写：列存在时只写一次", async () => {
    await upsertVolumes([{ coin: "XAU", volumeUsd: 5.6e8, price: 4356 }]);
    expect(upsertRows).toHaveLength(1);
  });
});

const cache = (entries: Array<[string, number]>): Map<string, CachedVolume> =>
  new Map(entries.map(([coin, updatedAt]) => [coin, { volumeUsd: 1, price: null, updatedAt }]));

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
        c.set(coin, { volumeUsd: 1, price: null, updatedAt: clock++ });
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
