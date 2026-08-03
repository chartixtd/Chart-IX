import { describe, it, expect } from "vitest";
import {
  buildMarketCapMap,
  hasTopRankCoverage,
  getMarketCapScore,
  formatCompactUsd,
  stripContractMultiplier,
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

// CoinGecko 分四页并发拉取，第 1 页装的是排名 1-250 —— 也就是市值排除规则唯一真正要
// 拦的那批币。第 1 页被限流、2-4 页成功时，返回的 750 行是"非空但缺了头部"的名单：
// BTC/ETH/SOL 在 map 里查不到 → 不被排除 + 市值维度拿满分，而前端的空 map 归一化
// 不会触发，提示条也不显示，完全静默。这个函数就是那道校验。
describe("hasTopRankCoverage", () => {
  it("accepts a page set that reaches into the excluded top ranks", () => {
    expect(
      hasTopRankCoverage([
        { symbol: "btc", market_cap: 1_200_000_000_000, market_cap_rank: 1 },
        { symbol: "wif", market_cap: 400_000_000, market_cap_rank: 180 },
      ])
    ).toBe(true);
  });

  it("accepts rows that stop exactly at the exclusion boundary", () => {
    expect(
      hasTopRankCoverage([{ symbol: "edge", market_cap: 3_000_000_000, market_cap_rank: 50 }])
    ).toBe(true);
  });

  // 这是 C1 的核心场景：页 2-4 成功、页 1 失败，行数很多但一个排除目标都没覆盖到。
  it("rejects a non-empty page set that starts past the exclusion boundary (page 1 was rate-limited)", () => {
    const rows = Array.from({ length: 750 }, (_, i) => ({
      symbol: `coin${i}`,
      market_cap: 100_000_000,
      market_cap_rank: 251 + i,
    }));
    expect(rows).toHaveLength(750); // 对照：行数非零，空 map 归一化不会触发
    expect(hasTopRankCoverage(rows)).toBe(false);
  });

  it("rejects an empty page set", () => {
    expect(hasTopRankCoverage([])).toBe(false);
  });

  it("rejects rows whose ranks are all null", () => {
    expect(
      hasTopRankCoverage([{ symbol: "unranked", market_cap: 5_000_000, market_cap_rank: null }])
    ).toBe(false);
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

describe("stripContractMultiplier", () => {
  it("strips 1000 multiplier prefix from BingX contract symbols", () => {
    expect(stripContractMultiplier("1000PEPE")).toBe("PEPE");
    expect(stripContractMultiplier("1000SHIB")).toBe("SHIB");
    expect(stripContractMultiplier("1000CAT")).toBe("CAT");
    expect(stripContractMultiplier("1000CHEEMS")).toBe("CHEEMS");
  });

  it("strips 10000 multiplier prefix from BingX contract symbols", () => {
    expect(stripContractMultiplier("10000SATS")).toBe("SATS");
    expect(stripContractMultiplier("10000NEX")).toBe("NEX");
  });

  it("strips 1000000 multiplier prefix from BingX contract symbols", () => {
    expect(stripContractMultiplier("1000000BABYDOGE")).toBe("BABYDOGE");
    expect(stripContractMultiplier("1000000MOG")).toBe("MOG");
    expect(stripContractMultiplier("1000000BOB")).toBe("BOB");
  });

  it("leaves genuine token names starting with digit-patterns unchanged", () => {
    expect(stripContractMultiplier("1INCH")).toBe("1INCH");
    expect(stripContractMultiplier("0G")).toBe("0G");
    expect(stripContractMultiplier("2Z")).toBe("2Z");
    expect(stripContractMultiplier("4")).toBe("4");
  });

  it("leaves ordinary symbols unchanged", () => {
    expect(stripContractMultiplier("WIF")).toBe("WIF");
    expect(stripContractMultiplier("SOLANA")).toBe("SOLANA");
    expect(stripContractMultiplier("BTC")).toBe("BTC");
  });
});

describe("constants", () => {
  it("matches the values the screener spec pins down", () => {
    expect(TOP_MARKET_CAP_EXCLUDED).toBe(50);
    expect(MARKET_CAP_FALLBACK_SCORE).toBe(50);
  });
});
