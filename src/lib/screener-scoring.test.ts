import { describe, it, expect } from "vitest";
import {
  hardFilter,
  isExcludedByMarketCap,
  selectCandidateSymbols,
  computeScreenerGroups,
  GROUP_SIZE,
  SCREENER_REFRESH_MS,
} from "./screener-scoring";
import type { MarketCapMap } from "./market-cap";
import type { BingXTicker } from "@/types/bingx";

function ticker(overrides: Partial<BingXTicker> & { symbol: string }): BingXTicker {
  return {
    symbol: overrides.symbol,
    openPrice: overrides.openPrice ?? "1",
    highPrice: overrides.highPrice ?? "1.03",
    lowPrice: overrides.lowPrice ?? "1",
    lastPrice: overrides.lastPrice ?? "1.01",
    volume: overrides.volume ?? "1000",
    quoteVolume: overrides.quoteVolume ?? "50000000",
    priceChange: overrides.priceChange ?? "0.01",
    priceChangePercent: overrides.priceChangePercent ?? "1",
    closeTime: overrides.closeTime ?? Date.now(),
  };
}

describe("SCREENER_REFRESH_MS", () => {
  it("is one hour", () => {
    expect(SCREENER_REFRESH_MS).toBe(3_600_000);
  });
});

describe("hardFilter", () => {
  it("keeps a healthy mid-volume mover", () => {
    expect(hardFilter(ticker({ symbol: "WIF-USDT" }), "long")).toBe(false);
  });

  it("drops coins below the volume floor", () => {
    expect(hardFilter(ticker({ symbol: "DUST-USDT", quoteVolume: "500000" }), "long")).toBe(true);
  });

  it("drops flat coins whose 24h amplitude is under 1.5%", () => {
    const flat = ticker({ symbol: "FLAT-USDT", highPrice: "1.005", lowPrice: "1" });
    expect(hardFilter(flat, "long")).toBe(true);
  });

  it("drops already-pumped coins for the long side but keeps them for the short side", () => {
    const pumped = ticker({ symbol: "PUMP-USDT", priceChangePercent: "22", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(pumped, "long")).toBe(true);
    expect(hardFilter(pumped, "short")).toBe(false);
  });

  it("drops already-dumped coins for the short side but keeps them for the long side", () => {
    const dumped = ticker({ symbol: "DUMP-USDT", priceChangePercent: "-25", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(dumped, "short")).toBe(true);
    expect(hardFilter(dumped, "long")).toBe(false);
  });

  it("drops rows with unparseable numbers", () => {
    expect(hardFilter(ticker({ symbol: "BAD-USDT", highPrice: "n/a" }), "long")).toBe(true);
  });

  it("drops rows with a non-positive low price", () => {
    expect(hardFilter(ticker({ symbol: "ZERO-USDT", lowPrice: "0" }), "long")).toBe(true);
  });
});

describe("isExcludedByMarketCap", () => {
  it("excludes coins ranked inside the top 50", () => {
    expect(isExcludedByMarketCap({ marketCap: 90_000_000_000, rank: 5 })).toBe(true);
    expect(isExcludedByMarketCap({ marketCap: 3_000_000_000, rank: 50 })).toBe(true);
  });

  it("keeps coins ranked outside the top 50", () => {
    expect(isExcludedByMarketCap({ marketCap: 400_000_000, rank: 51 })).toBe(false);
  });

  // 在 CoinGecko 前 1000 名里查不到 = 比第 1000 名还小，正是我们要的小币。
  it("keeps coins that are missing from the market cap data", () => {
    expect(isExcludedByMarketCap(undefined)).toBe(false);
  });
});

describe("selectCandidateSymbols", () => {
  const caps: MarketCapMap = {
    "BTC-USDT": { marketCap: 1_200_000_000_000, rank: 1 },
    "WIF-USDT": { marketCap: 400_000_000, rank: 180 },
  };

  it("returns the union of long and short survivors without duplicates", () => {
    const tickers = [
      ticker({ symbol: "WIF-USDT" }),
      ticker({ symbol: "PUMP-USDT", priceChangePercent: "22", highPrice: "1.3", lowPrice: "1" }),
    ];
    const symbols = selectCandidateSymbols(tickers, caps);
    expect(symbols).toContain("WIF-USDT");
    expect(symbols).toContain("PUMP-USDT");
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("drops top-50 coins", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "BTC-USDT" })], caps);
    expect(symbols).toEqual([]);
  });

  it("keeps top-50 coins when market cap data is unavailable", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "BTC-USDT" })], null);
    expect(symbols).toEqual(["BTC-USDT"]);
  });

  it("ignores non-USDT pairs", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "WIF-USDC" })], caps);
    expect(symbols).toEqual([]);
  });

  // BingX 把 SHIB 的千倍合约挂成 1000SHIB-USDT，而 CoinGecko 只认 shib。
  // 不剥乘数前缀的话，SHIB 这种 top-50 大币会整个绕过市值排除。
  it("drops a top-50 coin that BingX lists with a contract multiplier prefix", () => {
    const withShib: MarketCapMap = { ...caps, "SHIB-USDT": { marketCap: 6_000_000_000, rank: 20 } };
    const symbols = selectCandidateSymbols([ticker({ symbol: "1000SHIB-USDT" })], withShib);
    expect(symbols).toEqual([]);
  });

  // 1INCH 不是乘数命名，是真实币名，必须原样查得到。
  it("does not strip digits from genuine digit-leading token names", () => {
    const withInch: MarketCapMap = { "1INCH-USDT": { marketCap: 300_000_000, rank: 250 } };
    const symbols = selectCandidateSymbols([ticker({ symbol: "1INCH-USDT" })], withInch);
    expect(symbols).toEqual(["1INCH-USDT"]);
  });
});

describe("computeScreenerGroups", () => {
  const caps: MarketCapMap = {
    "BTC-USDT": { marketCap: 1_200_000_000_000, rank: 1 },
    "SMALL-USDT": { marketCap: 20_000_000, rank: 700 },
    "BIG-USDT": { marketCap: 1_800_000_000, rank: 70 },
  };

  it("excludes top-50 coins from both groups", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "BTC-USDT" })], {}, {}, caps);
    expect(groups.long).toEqual([]);
    expect(groups.short).toEqual([]);
  });

  it("ranks a smaller cap above a larger one when everything else matches", () => {
    const tickers = [ticker({ symbol: "SMALL-USDT" }), ticker({ symbol: "BIG-USDT" })];
    const oi = { "SMALL-USDT": 25_000_000, "BIG-USDT": 25_000_000 };
    const fr = { "SMALL-USDT": 0, "BIG-USDT": 0 };
    const groups = computeScreenerGroups(tickers, oi, fr, caps);
    expect(groups.long[0].symbol).toBe("SMALL-USDT");
    expect(groups.long[0].score).toBeGreaterThan(groups.long[1].score);
  });

  // 反转逻辑：费率为负 = 空头拥挤 = 潜在轧空 = 利好做多。
  it("favours negative funding on the long side and positive funding on the short side", () => {
    const tickers = [ticker({ symbol: "NEG-USDT" }), ticker({ symbol: "POS-USDT" })];
    const oi = { "NEG-USDT": 25_000_000, "POS-USDT": 25_000_000 };
    const fr = { "NEG-USDT": -0.0008, "POS-USDT": 0.0008 };
    const caps2: MarketCapMap = {
      "NEG-USDT": { marketCap: 100_000_000, rank: 300 },
      "POS-USDT": { marketCap: 100_000_000, rank: 300 },
    };
    const groups = computeScreenerGroups(tickers, oi, fr, caps2);
    expect(groups.long[0].symbol).toBe("NEG-USDT");
    expect(groups.short[0].symbol).toBe("POS-USDT");
  });

  it("caps each group at GROUP_SIZE entries", () => {
    const tickers = Array.from({ length: 25 }, (_, i) =>
      ticker({ symbol: `C${i}-USDT`, quoteVolume: String(10_000_000 + i * 1_000_000) })
    );
    const groups = computeScreenerGroups(tickers, {}, {}, {});
    expect(groups.long).toHaveLength(GROUP_SIZE);
    expect(groups.short).toHaveLength(GROUP_SIZE);
  });

  it("sorts each group by descending score", () => {
    const tickers = Array.from({ length: 6 }, (_, i) =>
      ticker({ symbol: `C${i}-USDT`, highPrice: String(1 + 0.02 * (i + 1)) })
    );
    const groups = computeScreenerGroups(tickers, {}, {}, {});
    const scores = groups.long.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("falls back to a neutral market cap score when the map is null", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "SMALL-USDT" })], {}, {}, null);
    expect(groups.long).toHaveLength(1);
    expect(groups.long[0].marketCap).toBeNull();
    expect(groups.long[0].marketCapRank).toBeNull();
  });

  it("populates the result row from the ticker and detail maps", () => {
    const groups = computeScreenerGroups(
      [ticker({ symbol: "SMALL-USDT", lastPrice: "1.02", highPrice: "1.04", lowPrice: "1", quoteVolume: "50000000" })],
      { "SMALL-USDT": 25_000_000 },
      { "SMALL-USDT": -0.0004 },
      caps
    );
    const row = groups.long[0];
    expect(row.symbol).toBe("SMALL-USDT");
    expect(row.lastPrice).toBe(1.02);
    expect(row.quoteVolume).toBe(50_000_000);
    expect(row.amplitude).toBeCloseTo(4, 5);
    expect(row.openInterest).toBe(25_000_000);
    expect(row.fundingRate).toBe(-0.0004);
    expect(row.oiVolumeRatio).toBeCloseTo(0.5, 5);
    expect(row.marketCap).toBe(20_000_000);
    expect(row.marketCapRank).toBe(700);
    expect(row.score).toBeGreaterThan(0);
    expect(row.score).toBeLessThanOrEqual(100);
  });

  it("reads market cap through the multiplier-stripped symbol", () => {
    const withPepe: MarketCapMap = { "PEPE-USDT": { marketCap: 7_000_000_000, rank: 30 } };
    // rank 30 在前 50 内 —— 剥掉 1000 前缀后必须被排除
    const excluded = computeScreenerGroups([ticker({ symbol: "1000PEPE-USDT" })], {}, {}, withPepe);
    expect(excluded.long).toEqual([]);

    // 同一个币若排在 50 名之外，则应保留并带上真实市值
    const smallPepe: MarketCapMap = { "PEPE-USDT": { marketCap: 400_000_000, rank: 130 } };
    const kept = computeScreenerGroups([ticker({ symbol: "1000PEPE-USDT" })], {}, {}, smallPepe);
    expect(kept.long).toHaveLength(1);
    expect(kept.long[0].symbol).toBe("1000PEPE-USDT");
    expect(kept.long[0].marketCap).toBe(400_000_000);
    expect(kept.long[0].marketCapRank).toBe(130);
  });

  it("treats a missing OI or funding entry as zero rather than dropping the row", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "SMALL-USDT" })], {}, {}, caps);
    expect(groups.long).toHaveLength(1);
    expect(groups.long[0].openInterest).toBe(0);
    expect(groups.long[0].fundingRate).toBe(0);
  });
});
