import { describe, it, expect } from "vitest";
import {
  buildMarketCapMap,
  getMarketCapScore,
  formatCompactUsd,
  TOP_MARKET_CAP_EXCLUDED,
  MARKET_CAP_FALLBACK_SCORE,
} from "./market-cap";

describe("buildMarketCapMap", () => {
  it("keys entries by the BingX perpetual symbol format", () => {
    const map = buildMarketCapMap([
      { symbol: "pepe", market_cap: 5_000_000_000, market_cap_rank: 25 },
    ]);
    expect(map["PEPE-USDT"]).toEqual({ marketCap: 5_000_000_000, rank: 25 });
  });

  // CoinGecko 里多个币可能共用同一个 ticker（例如山寨项目蹭名）。
  // 输入按 market_cap_desc 排序，所以第一次出现的就是市值最高的那个。
  it("keeps the first occurrence when two coins share a ticker", () => {
    const map = buildMarketCapMap([
      { symbol: "sol", market_cap: 80_000_000_000, market_cap_rank: 5 },
      { symbol: "sol", market_cap: 120_000, market_cap_rank: 4200 },
    ]);
    expect(map["SOL-USDT"].marketCap).toBe(80_000_000_000);
    expect(map["SOL-USDT"].rank).toBe(5);
  });

  it("skips rows with a null market cap or null rank", () => {
    const map = buildMarketCapMap([
      { symbol: "ghost", market_cap: null, market_cap_rank: 900 },
      { symbol: "phantom", market_cap: 1_000_000, market_cap_rank: null },
      { symbol: "real", market_cap: 1_000_000, market_cap_rank: 900 },
    ]);
    expect(map["GHOST-USDT"]).toBeUndefined();
    expect(map["PHANTOM-USDT"]).toBeUndefined();
    expect(map["REAL-USDT"]).toBeDefined();
  });

  it("skips rows with a non-positive market cap", () => {
    const map = buildMarketCapMap([
      { symbol: "zero", market_cap: 0, market_cap_rank: 900 },
    ]);
    expect(map["ZERO-USDT"]).toBeUndefined();
  });
});

describe("getMarketCapScore", () => {
  it("gives a full score when the coin is missing from CoinGecko data", () => {
    expect(getMarketCapScore(undefined)).toBe(100);
  });

  it("gives a full score at or below the $10M floor", () => {
    expect(getMarketCapScore({ marketCap: 10_000_000, rank: 900 })).toBe(100);
    expect(getMarketCapScore({ marketCap: 2_000_000, rank: 1500 })).toBe(100);
  });

  it("gives a zero score at or above the $2B ceiling", () => {
    expect(getMarketCapScore({ marketCap: 2_000_000_000, rank: 60 })).toBe(0);
    expect(getMarketCapScore({ marketCap: 50_000_000_000, rank: 8 })).toBe(0);
  });

  it("interpolates on a log scale between the floor and the ceiling", () => {
    // sqrt(10M * 2B) ≈ 141.42M —— log 区间正中点，应当接近 50 分
    const mid = getMarketCapScore({ marketCap: Math.sqrt(10_000_000 * 2_000_000_000), rank: 300 });
    expect(mid).toBeGreaterThan(49);
    expect(mid).toBeLessThan(51);
  });

  it("scores a smaller cap higher than a larger one", () => {
    const small = getMarketCapScore({ marketCap: 30_000_000, rank: 800 });
    const large = getMarketCapScore({ marketCap: 900_000_000, rank: 120 });
    expect(small).toBeGreaterThan(large);
  });
});

describe("formatCompactUsd", () => {
  it("formats billions, millions and thousands compactly", () => {
    expect(formatCompactUsd(2_400_000_000)).toBe("$2.40B");
    expect(formatCompactUsd(143_000_000)).toBe("$143.00M");
    expect(formatCompactUsd(52_000)).toBe("$52.00K");
    expect(formatCompactUsd(940)).toBe("$940.00");
  });
});

describe("constants", () => {
  it("matches the values the screener spec pins down", () => {
    expect(TOP_MARKET_CAP_EXCLUDED).toBe(50);
    expect(MARKET_CAP_FALLBACK_SCORE).toBe(50);
  });
});
