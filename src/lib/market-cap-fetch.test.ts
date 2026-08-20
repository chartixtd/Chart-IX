import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMarketCapRows } from "./market-cap-fetch";

/** 造一页 CoinGecko 行：page N 覆盖排名 (N-1)*250+1 .. N*250 */
function page(n: number) {
  return Array.from({ length: 250 }, (_, i) => {
    const rank = (n - 1) * 250 + i + 1;
    return { symbol: `C${rank}`, market_cap: 1e9 - rank, market_cap_rank: rank };
  });
}

/** ok 里列出哪些页成功；其余页返回 500 */
function mockPages(ok: number[]) {
  vi.stubGlobal("fetch", async (url: string) => {
    const n = Number(new URL(url).searchParams.get("page"));
    if (!ok.includes(n)) return { ok: false, status: 500 } as Response;
    return { ok: true, status: 200, json: async () => page(n) } as unknown as Response;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMarketCapRows 的分页兜底", () => {
  it("四页都成功时返回全部 1000 行", async () => {
    mockPages([1, 2, 3, 4]);
    expect(await fetchMarketCapRows()).toHaveLength(1000);
  });

  it("某页失败且有上一次的结果时用它顶上，不让那个排名区间整个消失", async () => {
    // 这条钉住的是一个**静默**缺陷：第 3、4 页失败时顶部校验照样通过，
    // 函数返回残缺名单，排名 500 名开外的币全部变成「查不到市值」被排除，
    // 而榜单看起来完全正常。实测撞上 CoinGecko 限流时候选池从 253 缩到 153。
    mockPages([1, 2, 3, 4]);
    await fetchMarketCapRows(); // 先暖上一次的结果

    mockPages([1, 2]); // 第 3、4 页挂掉
    const rows = await fetchMarketCapRows();
    expect(rows).toHaveLength(1000);
    // 关键：排名 500 名开外的区间必须还在
    expect(rows.some((r) => r.market_cap_rank === 999)).toBe(true);
  });

  it("第 1 页缺失时整体抛错，绝不返回缺了头部的名单", async () => {
    // 少了排名 1-250，大币会变成「查不到市值」而绕过前 50 名的排除规则，
    // 直接涌进小市值筛选器。这种情况宁可整轮失败。
    // 注意上一条用例已经把第 1 页暖进缓存了，所以这里要先清掉——
    // vi.unstubAllGlobals 清的是 fetch，不是模块内的兜底缓存。
    mockPages([1, 2, 3, 4]);
    await fetchMarketCapRows();
    // 用一个「成功但不含前 50 名」的第 1 页覆盖掉缓存
    vi.stubGlobal("fetch", async (url: string) => {
      const n = Number(new URL(url).searchParams.get("page"));
      if (n === 1) return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      return { ok: true, status: 200, json: async () => page(n) } as unknown as Response;
    });
    await expect(fetchMarketCapRows()).rejects.toThrow(/missing top ranks/);
  });
});
