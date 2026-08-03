import { describe, it, expect } from "vitest";
import {
  hardFilter,
  isExcludedByMarketCap,
  isSyntheticProduct,
  selectCandidateSymbols,
  computeScreenerGroups,
  computeCandidateScores,
  buildChange24hMap,
  GROUP_SIZE,
  MIN_QUOTE_VOLUME,
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
    expect(hardFilter(ticker({ symbol: "WIF-USDT" }), "long", undefined)).toBe(false);
  });

  it("drops coins below the volume floor", () => {
    expect(hardFilter(ticker({ symbol: "DUST-USDT", quoteVolume: "500000" }), "long", undefined)).toBe(true);
  });

  // 门槛值改过两次（1M → 5M → 7M），所以这一对断言全部相对 MIN_QUOTE_VOLUME 取值：
  // 门槛再动的时候它们跟着动，不会像写死的 fixture 那样悄悄掉到门槛下面变成空转。
  // ±1 是能取到的最小步长，卡在拐点两侧，任何方向的差一错误都会被抓到。
  it("drops a coin sitting one unit below MIN_QUOTE_VOLUME and keeps one sitting exactly on it", () => {
    const under = ticker({ symbol: "UNDER-USDT", quoteVolume: String(MIN_QUOTE_VOLUME - 1) });
    const onFloor = ticker({ symbol: "FLOOR-USDT", quoteVolume: String(MIN_QUOTE_VOLUME) });
    const over = ticker({ symbol: "OVER-USDT", quoteVolume: String(MIN_QUOTE_VOLUME + 1) });

    expect(hardFilter(under, "long", undefined)).toBe(true);
    expect(hardFilter(onFloor, "long", undefined)).toBe(false); // 门槛是 `<`，等于门槛应当存活
    expect(hardFilter(over, "long", undefined)).toBe(false);
  });

  // BingX 长尾的 quoteVolume 是被拍平的：实测 144 个不相干的币全挤在 619-691 万，
  // 门槛设在 5M 会正好落进这段假数据里。7M 是为了跨过整条假带才选的，
  // 这条断言把"假带上沿以下的成交量一律不可信、必须淘汰"钉住。
  it("drops a coin sitting inside BingX's clamped long-tail volume band (the reason the floor is 7M, not 5M)", () => {
    expect(MIN_QUOTE_VOLUME).toBeGreaterThan(6_913_330); // 假带实测上沿
    const clamped = ticker({ symbol: "CLAMPED-USDT", quoteVolume: "6500000" });
    expect(hardFilter(clamped, "long", undefined)).toBe(true);
  });

  it("drops flat coins whose 24h amplitude is under 1.5%", () => {
    const flat = ticker({ symbol: "FLAT-USDT", highPrice: "1.005", lowPrice: "1" });
    expect(hardFilter(flat, "long", undefined)).toBe(true);
  });

  // change24h 现在是显式传入的第三个参数（来自现货 24h 涨跌），不再从 ticker 自身的
  // priceChangePercent（那个 ~3 分钟的假 24h）读取。
  it("drops already-pumped coins for the long side but keeps them for the short side", () => {
    const pumped = ticker({ symbol: "PUMP-USDT", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(pumped, "long", 22)).toBe(true);
    expect(hardFilter(pumped, "short", 22)).toBe(false);
  });

  it("drops already-dumped coins for the short side but keeps them for the long side", () => {
    const dumped = ticker({ symbol: "DUMP-USDT", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(dumped, "short", -25)).toBe(true);
    expect(hardFilter(dumped, "long", -25)).toBe(false);
  });

  // change24h===undefined 意味着关联不到现货交易对，拿不到真实 24h 涨跌——
  // 不能因为"不知道"就假定它暴拉过，所以必须放行，即使换一个已知值会被淘汰。
  it("does not chase-filter when change24h is unknown, even though the same value would trigger the filter if known", () => {
    const pumped = ticker({ symbol: "PUMP-USDT", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(pumped, "long", 22)).toBe(true); // 对照组：已知 22% 时确实会被淘汰
    expect(hardFilter(pumped, "long", undefined)).toBe(false); // 未知时不淘汰

    const dumped = ticker({ symbol: "DUMP-USDT", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(dumped, "short", -25)).toBe(true); // 对照组：已知 -25% 时确实会被淘汰
    expect(hardFilter(dumped, "short", undefined)).toBe(false); // 未知时不淘汰
  });

  it("drops rows with unparseable numbers", () => {
    expect(hardFilter(ticker({ symbol: "BAD-USDT", highPrice: "n/a" }), "long", undefined)).toBe(true);
  });

  it("drops rows with a non-positive low price", () => {
    expect(hardFilter(ticker({ symbol: "ZERO-USDT", lowPrice: "0" }), "long", undefined)).toBe(true);
  });
});

describe("buildChange24hMap", () => {
  function spotTicker(symbol: string, priceChangePercent: string): BingXTicker {
    return ticker({ symbol, priceChangePercent });
  }

  it("associates a futures symbol with the matching spot symbol's 24h change", () => {
    const futures = [ticker({ symbol: "WIF-USDT" })];
    const spot = [spotTicker("WIF-USDT", "4.2")];
    expect(buildChange24hMap(futures, spot)).toEqual({ "WIF-USDT": 4.2 });
  });

  // BingX 给低价币的合约挂乘数前缀（1000SHIB-USDT），现货没有这个前缀（SHIB-USDT）。
  it("strips the contract multiplier prefix to associate 1000SHIB-USDT with spot SHIB-USDT", () => {
    const futures = [ticker({ symbol: "1000SHIB-USDT" })];
    const spot = [spotTicker("SHIB-USDT", "-1.8")];
    expect(buildChange24hMap(futures, spot)).toEqual({ "1000SHIB-USDT": -1.8 });
  });

  // 现货接口返回的是带百分号的字符串，parseFloat 会在遇到 "%" 时正确截断。
  it("parses a spot percent string with a trailing % sign", () => {
    const futures = [ticker({ symbol: "BTC-USDT" })];
    const spot = [spotTicker("BTC-USDT", "0.47%")];
    expect(buildChange24hMap(futures, spot)).toEqual({ "BTC-USDT": 0.47 });
  });

  it("omits a futures symbol with no matching spot pair", () => {
    const futures = [ticker({ symbol: "NOSPOT-USDT" })];
    const spot = [spotTicker("OTHER-USDT", "1")];
    expect(buildChange24hMap(futures, spot)).toEqual({});
  });

  it("omits a futures symbol when the matching spot percent is unparseable", () => {
    const futures = [ticker({ symbol: "BAD-USDT" })];
    const spot = [spotTicker("BAD-USDT", "n/a")];
    expect(buildChange24hMap(futures, spot)).toEqual({});
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

describe("isSyntheticProduct", () => {
  it("flags tokenized stocks (NCSK), commodities (NCCO), indices (NCSI) and forex (NCFX)", () => {
    expect(isSyntheticProduct("NCSKTSLA2USD-USDT")).toBe(true);
    expect(isSyntheticProduct("NCCOGOLD2USD-USDT")).toBe(true);
    expect(isSyntheticProduct("NCSINASDAQ1002USD-USDT")).toBe(true);
    expect(isSyntheticProduct("NCFXEUR2USD-USDT")).toBe(true);
  });

  it("does not flag genuine crypto symbols", () => {
    expect(isSyntheticProduct("BTC-USDT")).toBe(false);
    expect(isSyntheticProduct("WIF-USDT")).toBe(false);
    expect(isSyntheticProduct("MIRANETWORK-USDT")).toBe(false);
    expect(isSyntheticProduct("1000SHIB-USDT")).toBe(false);
  });

  // 假阳性防护：NCASH（Nucleus Vision）是真实币种，只是恰好以 "NC" 开头。
  // 用裸 "NC" 前缀会把它误杀，必须用四个明确前缀（NCSK/NCCO/NCSI/NCFX）才行。
  it("does not flag NCASH-USDT, a genuine token whose name starts with NC (false-positive guard)", () => {
    expect(isSyntheticProduct("NCASH-USDT")).toBe(false);
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

  // 代币化股票在 CoinGecko 查不到市值，量能和振幅又天然达标，如果不按前缀排除，
  // 会跟真实小市值币一起通过候选池筛选。
  it("drops a synthetic tokenized-stock symbol that would otherwise qualify as a candidate", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "NCSKTSLA2USD-USDT" })], null);
    expect(symbols).toEqual([]);
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

  // 市值是方向无关维度，在「本方向分 − 反方向分」里被整个消掉：它决定 score 的高低，
  // 但不再决定组内先后（两个币的 edge 在这里完全相同）。所以这条断言的是 score 本身。
  // 两个币除市值外完全一致：振幅3%(20) 资金费率0(10) OI ratio=0.5(15) 动量未知(5)
  // 位置 eff_long=(1.01-1)/0.03=1/3（平台，10）→ 方向无关部分 + 方向部分合计 60。
  //   SMALL cap=20M  → capSub=100-100*(log10(2e7)-log10(1e7))/(log10(2e9)-log10(1e7))=86.9175
  //                    → 60 + 25*0.869175 = 81.729 -> 82
  //   BIG   cap=1.8B → capSub=1.9887 → 60 + 25*0.019887 = 60.497 -> 60
  it("scores a smaller cap above a larger one when everything else matches", () => {
    const tickers = [ticker({ symbol: "SMALL-USDT" }), ticker({ symbol: "BIG-USDT" })];
    const oi = { "SMALL-USDT": 25_000_000, "BIG-USDT": 25_000_000 };
    const fr = { "SMALL-USDT": 0, "BIG-USDT": 0 };
    const groups = computeScreenerGroups(tickers, oi, fr, caps);
    const bySymbol = Object.fromEntries(groups.long.map((r) => [r.symbol, r]));

    expect(bySymbol["SMALL-USDT"].score).toBe(82);
    expect(bySymbol["BIG-USDT"].score).toBe(60);
    expect(bySymbol["SMALL-USDT"].score).toBeGreaterThan(bySymbol["BIG-USDT"].score);
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

  // 25 个币得先真的分成两拨才谈得上"两组各截断到 10"：差值为正才有资格进组，
  // 所以这里用资金费率把前 12 个压向做多、后 13 个压向做空（默认行情的位置维度
  // eff_long=1/3 → 10 分、eff_short=2/3 → 6.67 分，本身只提供 +3.33 的做多倾斜，
  // ±0.0008 的费率给出 ±20 分，足以盖过它）：
  //   前 12 个 fr=-0.0008 → 做多差值 = 20 + 3.33 = 23.33 > 0 → 12 个候选，截断到 10
  //   后 13 个 fr=+0.0008 → 做空差值 = 20 - 3.33 = 16.67 > 0 → 13 个候选，截断到 10
  it("caps each group at GROUP_SIZE entries", () => {
    const tickers = Array.from({ length: 25 }, (_, i) =>
      ticker({ symbol: `C${i}-USDT`, quoteVolume: String(10_000_000 + i * 1_000_000) })
    );
    const fr = Object.fromEntries(tickers.map((t, i) => [t.symbol, i < 12 ? -0.0008 : 0.0008]));
    const groups = computeScreenerGroups(tickers, {}, fr, {});
    expect(groups.long).toHaveLength(GROUP_SIZE);
    expect(groups.short).toHaveLength(GROUP_SIZE);
  });

  // 这条原本断言"组内按绝对分降序"，改成按方向分差排序后已经不成立了，但它锁定的那组
  // 振幅算式仍然有价值，于是改钉一件更根本的事：**方向无关的维度只影响 score，不影响 edge**。
  // 三条振幅不同、其余五个维度锁定一致的行情，
  // 振幅子分应为 3(amp=3,峰值,100) > 8.5(amp=8.5,下降段中点,50) > 1.5(amp=1.5,下降段起点,0)。
  // 没有传 change24hMap，三个 symbol 都关联不到 24h 涨跌 → 动量维度统一拿中性 50 分
  // （0.1*50=5，而不是旧版靠 priceChangePercent 锁定的 0.1*100=10），
  // 其余四个维度锁定分之和为 25(市值,查不到→100)+10(资金费率,rate=0→50)+15(OI,ratio=1.0→100)+10(位置,eff=0.3→100)=60，
  // 加上动量 5 = 65，再加振幅 20*ampSub：
  // 对应总分 85(振幅100) > 75(振幅50) > 65(振幅0)（算法见下面 "amplitude" 维度测试块的注释）。
  // 而三个币的 edge 完全相同：三个方向维度（资金费率 10/10、动量 5/5、位置 10/6）
  // 对它们一模一样 → edge = 10 - 6 = 4。振幅这 20 分在差值里被整个消掉。
  it("lets a direction-neutral dimension move the score without moving the edge", () => {
    const base = {
      lowPrice: "1000",
      quoteVolume: "50000000",
    };
    const tickers = [
      ticker({ symbol: "ORD-LOW-USDT", ...base, highPrice: "1015", lastPrice: "1004.5" }), // amp=1.5
      ticker({ symbol: "ORD-MID-USDT", ...base, highPrice: "1030", lastPrice: "1009" }), // amp=3
      ticker({ symbol: "ORD-HIGH-USDT", ...base, highPrice: "1085", lastPrice: "1025.5" }), // amp=8.5
    ];
    const oi = { "ORD-LOW-USDT": 50_000_000, "ORD-MID-USDT": 50_000_000, "ORD-HIGH-USDT": 50_000_000 };
    const fr = { "ORD-LOW-USDT": 0, "ORD-MID-USDT": 0, "ORD-HIGH-USDT": 0 };
    const groups = computeScreenerGroups(tickers, oi, fr, {});
    const bySymbol = Object.fromEntries(groups.long.map((r) => [r.symbol, r]));

    expect(bySymbol["ORD-MID-USDT"].score).toBe(85);
    expect(bySymbol["ORD-HIGH-USDT"].score).toBe(75);
    expect(bySymbol["ORD-LOW-USDT"].score).toBe(65);
    expect(groups.long.map((r) => r.edge)).toEqual([4, 4, 4]);
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

  // 缺失的 OI 现在报成 null 而不是 0：fetchDetailMap 只写入成功拿到的值，
  // "请求失败" 和 "真的是 0" 必须能区分开（打分上前者中性、后者 0 分）。
  // 资金费率仍然默认 0，因为 fundingScore(0) 恰好就是中性 50，碰巧优雅降级。
  it("reports a missing OI as null and a missing funding rate as zero rather than dropping the row", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "SMALL-USDT" })], {}, {}, caps);
    expect(groups.long).toHaveLength(1);
    expect(groups.long[0].openInterest).toBeNull();
    expect(groups.long[0].oiVolumeRatio).toBeNull();
    expect(groups.long[0].fundingRate).toBe(0);
  });

  // OI 请求部分失败时，旧实现让 `oiMap[symbol] ?? 0` 把失败的币砸到 oiRatioScore(0)=0，
  // 白丢 15 分——排名于是纯粹按请求运气重排。现在未知走中性 50。
  // 三个币除 OI 外完全一致（市值查不到=100、振幅3%=100、费率0=50、位置eff=0.3=100，
  // 合计 25+20+10+5(动量未知,中性50)+10 = 70）：
  //   HASOI  ratio=1.0（平台内）→ oiSub=100 → 70 + 15    = 85
  //   NOOI   未知              → oiSub=50  → 70 + 7.5  = 77.5 -> 78
  //   ZEROOI ratio=0           → oiSub=0   → 70 + 0    = 70
  it("scores an unknown OI as neutral instead of zero, keeping it above a coin whose OI is genuinely zero", () => {
    const base = { lowPrice: "1000", highPrice: "1030", lastPrice: "1009", quoteVolume: "50000000" };
    const tickers = [
      ticker({ symbol: "HASOI-USDT", ...base }),
      ticker({ symbol: "NOOI-USDT", ...base }),
      ticker({ symbol: "ZEROOI-USDT", ...base }),
    ];
    // NOOI-USDT 刻意不在 oiMap 里
    const oi = { "HASOI-USDT": 50_000_000, "ZEROOI-USDT": 0 };
    const groups = computeScreenerGroups(tickers, oi, {}, {});
    // OI 是方向无关维度，三个币的 edge 相同，组内先后已经不由它决定了 ——
    // 按 symbol 取行，别让这条断言退化成"回声输入顺序"。
    const bySymbol = Object.fromEntries(groups.long.map((r) => [r.symbol, r]));

    expect(bySymbol["HASOI-USDT"].score).toBe(85);
    expect(bySymbol["NOOI-USDT"].score).toBe(78);
    expect(bySymbol["ZEROOI-USDT"].score).toBe(70);
    expect(bySymbol["NOOI-USDT"].score).toBeGreaterThan(bySymbol["ZEROOI-USDT"].score);

    const noOi = bySymbol["NOOI-USDT"];
    expect(noOi.openInterest).toBeNull();
    expect(noOi.oiVolumeRatio).toBeNull();
    // 对照：真的是 0 的那个仍然报 0，不是 null——两种情况没有被混为一谈
    expect(bySymbol["ZEROOI-USDT"].openInterest).toBe(0);
    expect(bySymbol["ZEROOI-USDT"].oiVolumeRatio).toBe(0);
  });

  // priceChangePercent 现在是查表结果，不是 ticker 自身的字段：查不到就是 null
  // （表格据此显示 "-"），查得到就是现货的真实 24h 涨跌。
  // 生产环境实测的失败场景：代币化股票（如 NCSKTSLA2USD，即 Tesla）在 CoinGecko
  // 查不到市值，走「查不到=微型盘」分支白拿 25% 权重的满分（100），量能刚过门槛，
  // 振幅 ~2.5% 又落在打分甜点区，结果比真实小市值币分还高，顶到榜首。
  // 量能取 12M 而不是实测的 1.2M：门槛提到 7M 之后 1.2M 会先被成交量淘汰，
  // 那样这条断言就成了空转，证明不了前缀排除本身有效。12M 同时也跨过了
  // BingX 长尾那条被拍平的假成交量带（619-691 万），不会随门槛微调而失效。
  it("keeps a synthetic tokenized-stock symbol out of both groups even though it clears every filter and would score 100 on smallness (production failure mode)", () => {
    const synthetic = ticker({
      symbol: "NCSKTSLA2USD-USDT",
      lowPrice: "1000",
      highPrice: "1025", // amplitude = 2.5%
      lastPrice: "1007.5",
      quoteVolume: "12000000",
    });
    const groups = computeScreenerGroups([synthetic], {}, {}, {});
    expect(groups.long.some((r) => r.symbol === "NCSKTSLA2USD-USDT")).toBe(false);
    expect(groups.short.some((r) => r.symbol === "NCSKTSLA2USD-USDT")).toBe(false);

    // 对照组：完全相同的行情，只把前缀换掉 —— 它确实通过了所有过滤，
    // 说明上面被排除的原因只可能是前缀本身，而不是量能或振幅。
    const control = computeScreenerGroups(
      [ticker({ ...synthetic, symbol: "REALCOIN-USDT" })],
      {},
      {},
      {}
    );
    expect(control.long.some((r) => r.symbol === "REALCOIN-USDT")).toBe(true);
  });

  it("reports priceChangePercent as null when unassociated and as the spot value when associated", () => {
    const noMap = computeScreenerGroups([ticker({ symbol: "SMALL-USDT" })], {}, {}, caps);
    expect(noMap.long[0].priceChangePercent).toBeNull();

    const withMap = computeScreenerGroups(
      [ticker({ symbol: "SMALL-USDT" })],
      {},
      {},
      caps,
      { "SMALL-USDT": 4.2 }
    );
    expect(withMap.long[0].priceChangePercent).toBe(4.2);
  });
});

// ---------------------------------------------------------------------------
// 方向分差排序：两组不再各自按绝对分排，而是按「本方向分 − 反方向分」排。
//
// 下面这批测试共用一条参照行情，方向无关的三个维度全部锁死，只留方向相关的三个变动：
//   市值(25%)   = 100 —— caps 传 {}，查不到 → getMarketCapScore(undefined)=100 → 25
//   振幅(20%)   = 100 —— low=1000, high=1030 → amplitude=3%，落在 [2,5] 平台 → 20
//   OI/量比(15%) = 100 —— openInterest=quoteVolume=50M → ratio=1.0，落在平台 → 15
// 方向无关部分合计 60，且它在两个方向上完全相同 —— 所以它在差值里被整个消掉。
// 剩下三个方向维度：资金费率 20*f、动量 10*m、趋势位置 10*p。
//
// 常用取值（手算备查）：
//   fundingRate=-0.0005  → f_long=1.0(20)  f_short=0(0)
//   fundingRate=-0.0001  → f_long=0.6(12)  f_short=0.4(8)
//   fundingRate=0        → f_long=0.5(10)  f_short=0.5(10)
//   fundingRate=+0.00025 → f_long=0.25(5)  f_short=0.75(15)
//   fundingRate=+0.0005  → f_long=0(0)     f_short=1.0(20)
//   lastPrice=1009 → eff_long=0.3（平台，p=1.0→10）  eff_short=0.7（p=1-(0.7-0.5)/0.5=0.6→6）
//   lastPrice=1015 → eff_long=0.5（平台，p=1.0→10）  eff_short=0.5（平台，p=1.0→10）
//   lastPrice=1027 → eff_long=0.9（p=1-(0.9-0.5)/0.5=0.2→2）eff_short=0.1（p=0.1/0.2=0.5→5）
//   change24h 不传 → 多空两个方向都拿中性 50（m=0.5→5），在差值里同样被消掉
describe("directional edge ranking", () => {
  const EDGE_REF = { lowPrice: "1000", highPrice: "1030", quoteVolume: "50000000" };

  /** 造一个只在 lastPrice / fundingRate 上有差别的候选 */
  function edgeTicker(symbol: string, lastPrice: string): BingXTicker {
    return ticker({ symbol, ...EDGE_REF, lastPrice });
  }

  // 五个币的手算分（方向无关部分 60 对所有币相同）：
  //   L1 fr=-0.0005  last=1009 → 多 60+20+5+10=95  空 60+0+5+6=71   差 +24 / -24
  //   L2 fr=+0       last=1009 → 多 60+10+5+10=85  空 60+10+5+6=81  差 +4  / -4
  //   S1 fr=+0.0005  last=1027 → 多 60+0+5+2=67    空 60+20+5+5=90  差 -23 / +23
  //   S2 fr=+0.00025 last=1027 → 多 60+5+5+2=72    空 60+15+5+5=85  差 -13 / +13
  //   N1 fr=0        last=1015 → 多 60+10+5+10=85  空 60+10+5+10=85 差 0 / 0（两组都进不去）
  const L1 = edgeTicker("L1-USDT", "1009");
  const L2 = edgeTicker("L2-USDT", "1009");
  const S1 = edgeTicker("S1-USDT", "1027");
  const S2 = edgeTicker("S2-USDT", "1027");
  const N1 = edgeTicker("N1-USDT", "1015");
  // 刻意打乱输入顺序：两组的期望顺序（L1,L2 / S1,S2）都和输入顺序不同，
  // 排序退化成"回声输入顺序"时这条会立刻失败。
  const pool = [L2, S2, N1, L1, S1];
  const poolOi = Object.fromEntries(pool.map((t) => [t.symbol, 50_000_000]));
  const poolFr = {
    "L1-USDT": -0.0005,
    "L2-USDT": 0,
    "S1-USDT": 0.0005,
    "S2-USDT": 0.00025,
    "N1-USDT": 0,
  };

  // 这是这次改动的全部目的：差值为正的币只可能落在一边，两组必然不相交。
  // 改回按绝对分排序，这条会立刻失败（旧实现下 L1/L2/S1/S2 会大面积同时出现在两组里）。
  it("never places the same coin in both groups", () => {
    const groups = computeScreenerGroups(pool, poolOi, poolFr, {});
    const longSymbols = new Set(groups.long.map((r) => r.symbol));
    const overlap = groups.short.filter((r) => longSymbols.has(r.symbol));

    expect(overlap).toEqual([]);
    // 防空转：两组都得真的有东西，否则"不相交"毫无意义
    expect(groups.long.length).toBeGreaterThan(0);
    expect(groups.short.length).toBeGreaterThan(0);
  });

  it("orders each group by descending edge, not by descending absolute score", () => {
    const groups = computeScreenerGroups(pool, poolOi, poolFr, {});

    expect(groups.long.map((r) => r.symbol)).toEqual(["L1-USDT", "L2-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([95, 85]);
    expect(groups.long.map((r) => r.edge)).toEqual([24, 4]);

    expect(groups.short.map((r) => r.symbol)).toEqual(["S1-USDT", "S2-USDT"]);
    expect(groups.short.map((r) => r.score)).toEqual([90, 85]);
    expect(groups.short.map((r) => r.edge)).toEqual([23, 13]);
  });

  // 核心回归：绝对分高但方向持平的币，必须排在绝对分低但方向偏向明显的币后面。
  // A: caps 里查不到 → 市值 25 分；fr=0（10/10）；last=1013.5 → eff_long=0.45（平台，p=1.0→10），
  //    eff_short=0.55（p=1-(0.55-0.5)/0.5=0.9→9）
  //    A 多 = 25+20+10+15+5+10 = 85   A 空 = 25+20+10+15+5+9 = 84   差 = +1
  // B: caps 里 cap=2e9（ceiling）→ 市值 0 分；fr=-0.0005（20/0）；last=1009（10/6）
  //    B 多 = 0+20+20+15+5+10 = 70    B 空 = 0+20+0+15+5+6 = 46     差 = +24
  // 按旧的绝对分排序 A(85) 会排在 B(70) 前面；按差值 B(+24) 必须排在 A(+1) 前面。
  it("ranks a lower-scoring coin with a strong edge above a higher-scoring coin with a flat edge", () => {
    const tickers = [edgeTicker("EDGEA-USDT", "1013.5"), edgeTicker("EDGEB-USDT", "1009")];
    const oi = { "EDGEA-USDT": 50_000_000, "EDGEB-USDT": 50_000_000 };
    const fr = { "EDGEA-USDT": 0, "EDGEB-USDT": -0.0005 };
    const caps2: MarketCapMap = { "EDGEB-USDT": { marketCap: 2_000_000_000, rank: 70 } };

    const groups = computeScreenerGroups(tickers, oi, fr, caps2);

    expect(groups.long.map((r) => r.symbol)).toEqual(["EDGEB-USDT", "EDGEA-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([70, 85]);
    expect(groups.long.map((r) => r.edge)).toEqual([24, 1]);
  });

  // 差值 ≤ 0 就是"这个方向上没有优势"，塞进这一组是误导——宁可这组不足 10 个。
  it("keeps a coin whose opposite-direction score is higher out of that group", () => {
    const groups = computeScreenerGroups(pool, poolOi, poolFr, {});
    // S1 多头 67 < 空头 90 → 差值为负，不该出现在做多组
    expect(groups.long.some((r) => r.symbol === "S1-USDT")).toBe(false);
    expect(groups.short.some((r) => r.symbol === "S1-USDT")).toBe(true);
  });

  it("keeps a coin whose two directional scores are exactly equal out of both groups", () => {
    const groups = computeScreenerGroups(pool, poolOi, poolFr, {});
    // N1 多空同为 85 → 差值恰好 0，两边都没有优势
    expect(groups.long.some((r) => r.symbol === "N1-USDT")).toBe(false);
    expect(groups.short.some((r) => r.symbol === "N1-USDT")).toBe(false);
  });

  // 市场一边倒时某一组不足 10 个是真实信息，不能靠塞反向币补满。
  it("returns fewer than GROUP_SIZE rows when only a few coins have a positive edge", () => {
    const groups = computeScreenerGroups(pool, poolOi, poolFr, {});
    expect(groups.long).toHaveLength(2);
    expect(groups.short).toHaveLength(2);
    expect(GROUP_SIZE).toBeGreaterThan(2); // 防空转：确认 2 确实是"不足 10"而不是上限本身
  });

  // edge 就是两个方向绝对分之差，这里用 computeCandidateScores 把两个方向的分都摊开来对。
  it("reports edge as the exact difference between the two directional scores", () => {
    const [l1] = computeCandidateScores([L1], poolOi, poolFr, {});
    expect(l1.longScore).toBe(95);
    expect(l1.shortScore).toBe(71);

    const groups = computeScreenerGroups([L1], poolOi, poolFr, {});
    expect(groups.long[0].score).toBe(95);
    expect(groups.long[0].edge).toBe(24); // 95 - 71
  });

  // hardFilter 是分方向的（追高只淘汰做多、追空只淘汰做空），但差值永远用两个方向的分算。
  // PUMP: change24h=+22 → 做多被 hardFilter 淘汰；两个方向的动量都落在范围外拿 0 分
  //   （多头 signed=22>15 → 0；空头 signed=-22<=-15 → 0）
  //   last=1027 → 多头 p=0.2(2)，空头 p=0.5(5)；fr=0 → 10/10
  //   多 = 25+20+10+15+0+2 = 72（这个分不会出现在任何一组里，但差值要用它）
  //   空 = 25+20+10+15+0+5 = 75
  //   做空组差值 = 75 - 72 = +3。若实现把"被淘汰的方向"当成 0 分，差值会变成 75。
  it("computes edge from both directional scores even when one direction was dropped by hardFilter", () => {
    const pump = edgeTicker("PUMP-USDT", "1027");
    const oi = { "PUMP-USDT": 50_000_000 };
    const change24h = { "PUMP-USDT": 22 };

    const [scores] = computeCandidateScores([pump], oi, {}, {}, change24h);
    expect(scores.longEligible).toBe(false); // 追高，做多方向被淘汰
    expect(scores.shortEligible).toBe(true);
    expect(scores.longScore).toBe(72); // 被淘汰的方向仍然算得出分
    expect(scores.shortScore).toBe(75);

    const groups = computeScreenerGroups([pump], oi, {}, {}, change24h);
    expect(groups.long).toEqual([]);
    expect(groups.short).toHaveLength(1);
    expect(groups.short[0].score).toBe(75);
    expect(groups.short[0].edge).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 六个打分维度逐一钉住：曲线形状 + 权重。
//
// 方法：固定一条"参照行情"，除被测维度外，其余五个维度都钉在一个已知子分上，
// 然后在被测维度的关键断点（下沿拐点、平台、上沿拐点、范围外）取值，
// 手算整条公式的期望总分（四舍五入前打印在注释里），断言 row.score 精确等于该整数。
//
// 参照行情的五个"锁定"子分（权重 x 子分，子分用 0~1 表示）：
//   市值(25%)   = 1.0  —— marketCapMap 里查不到该 symbol，getMarketCapScore(undefined) = 100
//   振幅(20%)   = 1.0  —— lowPrice=1000, highPrice=1030 → amplitude=3%，落在 [2,5] 平台
//   资金费率(20%) = 0.5  —— fundingRate=0 → signed=0 → 线性区间中点 = 50
//   OI/量比(15%) = 1.0  —— openInterest = quoteVolume → ratio=1.0，落在 [0.3,1.5] 平台
//   动量(10%)   = 0.5  —— scoreOf 默认不传 change24hMap，X-USDT 关联不到 24h 涨跌 →
//                          momentumScore 未知分支返回中性 50（不是旧版靠 priceChangePercent
//                          锁定的峰值 100；ticker 自身的 priceChangePercent 字段已不再参与打分）
//   趋势位置(10%) = 1.0  —— lastPrice 取 low + 0.3*(high-low) → eff=0.3，落在 [0.2,0.5] 平台
// 这五项锁定后的基准分是 25+20+10+15+5+10 = 85（对应下面"振幅"测试里 amp=3 那一档）。
//
// 每个数值都先用一份独立于 screener-scoring.ts 的最小复现脚本（同样的公式，来自本文件
// 顶部大括号引用的 brief 打分表）离线跑过，确认不会卡在四舍五入的 .5 边界上，
// 也确认价格字符串经 parseFloat 后不会因为浮点误差跌到分段判断的错误一侧
// （例如 highPrice="1.015" 算出的 amplitude 实测是 1.4999999999999902，会被 hardFilter
// 误杀——所以这里全部改用 lowPrice="1000" 的整数基准价格，测过打点精确落在断点上）。
describe("scoring dimension curves (weights and breakpoints, long direction)", () => {
  const REF = {
    lowPrice: "1000",
    highPrice: "1030", // amplitude = 3%，除非该维度自己就是被测维度
    lastPrice: "1009", // eff = (1009-1000)/(1030-1000) = 0.3
    quoteVolume: "50000000",
  };
  // 这里读 computeCandidateScores 而不是 groups.long[0].score：分组现在按方向分差取，
  // 做多分低于做空分的币根本进不了做多组（例如本块里 fundingRate>0 的那几档，
  // 或 eff=0.5 这种两个方向打平的位置），但它的做多分依然真实存在、依然要被钉住。
  // 用绝对分入口测绝对分，分组规则的变化不该把维度曲线的覆盖率带走。
  function scoreOf(
    overrides: Partial<BingXTicker>,
    oi = 50_000_000,
    fr = 0,
    marketCapMap: MarketCapMap | null = {},
    change24hMap: Record<string, number> = {}
  ) {
    const t = ticker({ symbol: "X-USDT", ...REF, ...overrides });
    const candidates = computeCandidateScores(
      [t],
      { "X-USDT": oi },
      { "X-USDT": fr },
      marketCapMap,
      change24hMap
    );
    expect(candidates).toHaveLength(1); // 前置断言：确认没有被市值/前缀规则整个剔除
    expect(candidates[0].longEligible).toBe(true); // 前置断言：确认没有被 hardFilter 误杀
    return candidates[0].longScore;
  }

  it("市值 25%：floor(<=10M)=100，中间对数插值，ceiling(>=2B)=0，超出 ceiling 仍是 0", () => {
    // 固定：振幅1.0 资金费率0.5 OI1.0 动量0.5(未知,中性) 位置1.0 → 60 + 25*capSub
    const capMap = (cap: number): MarketCapMap => ({ "X-USDT": { marketCap: cap, rank: 700 } });

    // cap=10,000,000（floor）→ capSub=1.0 → 60 + 25*1.0 = 85
    expect(scoreOf({}, 50_000_000, 0, capMap(10_000_000))).toBe(85);

    // cap=100,000,000（floor 与 ceiling 之间的对数插值点）
    // capSub = 100 - 100*(log10(1e8)-log10(1e7))/(log10(2e9)-log10(1e7)) = 56.5412...
    // 60 + 25*0.565412... = 74.1353... -> 74
    expect(scoreOf({}, 50_000_000, 0, capMap(100_000_000))).toBe(74);

    // cap=2,000,000,000（ceiling）→ capSub=0 → 60 + 25*0 = 60
    expect(scoreOf({}, 50_000_000, 0, capMap(2_000_000_000))).toBe(60);

    // cap=5,000,000,000（超出 ceiling，仍应钳制在 0）→ 60
    expect(scoreOf({}, 50_000_000, 0, capMap(5_000_000_000))).toBe(60);
  });

  it("振幅 20%：[1.5,2) 线性上升，[2,5] 平台=100，(5,12] 线性下降，>12 或 <1.5 =0", () => {
    // 固定：市值1.0 资金费率0.5 OI1.0 动量0.5(未知,中性) 位置1.0 → 65 + 20*ampSub
    // 注意：position 用 last = low + 0.3*(high-low) 保持 eff=0.3 不受 high 变化影响

    // amplitude=1.5（下沿拐点，也是 hardFilter 的存活边界）→ ampSub=0 → 65 + 0 = 65
    expect(scoreOf({ highPrice: "1015", lastPrice: "1004.5" })).toBe(65);

    // amplitude=1.75（上升段中点）→ ampSub=(1.75-1.5)/0.5=0.5 → 65+10=75
    expect(scoreOf({ highPrice: "1017.5", lastPrice: "1005.25" })).toBe(75);

    // amplitude=3（平台内）→ ampSub=1.0 → 65+20=85
    expect(scoreOf({ highPrice: "1030", lastPrice: "1009" })).toBe(85);

    // amplitude=6.5（下降段前段）。这一点专门用来卡住"平台从 [2,5] 误改成 [2,8]"这类改动——
    // 6.5 在原公式里已经离开平台进入下降段，但若平台被错误拓宽到 8，6.5 会被误判成还在平台内（=100）。
    // ampSub = 1-(6.5-5)/7 = 0.7857142857142857 → 65+20*0.7857142857142857 = 80.71428571428572 -> 81
    expect(scoreOf({ highPrice: "1065", lastPrice: "1019.5" })).toBe(81);

    // amplitude=8.5（下降段中点）→ ampSub=1-(8.5-5)/7=0.5 → 65+10=75
    expect(scoreOf({ highPrice: "1085", lastPrice: "1025.5" })).toBe(75);

    // amplitude=12（上沿拐点）→ ampSub=1-(12-5)/7=0 → 65+0=65
    expect(scoreOf({ highPrice: "1120", lastPrice: "1036" })).toBe(65);

    // amplitude=15（范围外，超过 12）→ ampSub=0（flat）→ 65
    expect(scoreOf({ highPrice: "1150", lastPrice: "1045" })).toBe(65);
  });

  it("资金费率方向 20%：signed<=-0.0005 =0，signed>=0.0005 =100，中间线性；多头 signed=-rate", () => {
    // 固定：市值1.0 振幅1.0 OI1.0 动量0.5(未知,中性) 位置1.0 → 75 + 20*fundSub
    // 多头 signed = -fundingRate

    // fundingRate=0.0005 → signed=-0.0005（下沿拐点）→ fundSub=0 → 75
    expect(scoreOf({}, 50_000_000, 0.0005)).toBe(75);

    // fundingRate=0.00025 → signed=-0.00025（下半段线性中点）→ fundSub=0.25 → 75+5=80
    expect(scoreOf({}, 50_000_000, 0.00025)).toBe(80);

    // fundingRate=0 → signed=0（线性区间中点）→ fundSub=0.5 → 75+10=85
    expect(scoreOf({}, 50_000_000, 0)).toBe(85);

    // fundingRate=-0.00025 → signed=0.00025（上半段线性中点）→ fundSub=0.75 → 75+15=90
    expect(scoreOf({}, 50_000_000, -0.00025)).toBe(90);

    // fundingRate=-0.0005 → signed=0.0005（上沿拐点）→ fundSub=1.0 → 75+20=95
    expect(scoreOf({}, 50_000_000, -0.0005)).toBe(95);

    // fundingRate=-0.002（范围外，signed=0.002 远超上沿）→ 仍钳制在 fundSub=1.0 → 95
    expect(scoreOf({}, 50_000_000, -0.002)).toBe(95);

    // fundingRate=0.002（范围外，signed=-0.002 远超下沿）→ 仍钳制在 fundSub=0 → 75
    expect(scoreOf({}, 50_000_000, 0.002)).toBe(75);
  });

  it("OI/量比 15%：[0.3,1.5] 平台=100，<0.3 线性 0→100，(1.5,3] 线性 100→0，>3 =0", () => {
    // 固定：市值1.0 振幅1.0 资金费率0.5 动量0.5(未知,中性) 位置1.0 → 70 + 15*oiSub

    // ratio=0（极端低）→ oiSub=0 → 70
    expect(scoreOf({}, 0)).toBe(70);

    // ratio=0.15（下沿线性段中点）→ oiSub=0.15/0.3=0.5 → 70+7.5=77.5 -> 78
    expect(scoreOf({}, 7_500_000)).toBe(78);

    // ratio=0.3（下沿拐点，平台起点）→ oiSub=1.0 → 85
    expect(scoreOf({}, 15_000_000)).toBe(85);

    // ratio=1.5（上沿拐点，平台终点）→ oiSub=1.0 → 85
    expect(scoreOf({}, 75_000_000)).toBe(85);

    // ratio=2.25（下降段中点）→ oiSub=1-(2.25-1.5)/1.5=0.5 → 70+7.5=77.5 -> 78
    expect(scoreOf({}, 112_500_000)).toBe(78);

    // ratio=3（下降段终点）→ oiSub=0 → 70
    expect(scoreOf({}, 150_000_000)).toBe(70);

    // ratio=4（范围外，超过 3）→ oiSub=0（flat）→ 70
    expect(scoreOf({}, 200_000_000)).toBe(70);
  });

  // change24h 现在来自 change24hMap（模拟现货 24h 涨跌关联结果），不再来自
  // ticker 自身的 priceChangePercent（那个字段已经从 parse() 里删掉，不参与打分）。
  // 曲线已从「signed<=0 一律 0 分」改成以 +3% 为峰、两侧递减的形状。
  // 旧曲线让「查不到 24h 涨跌」（中性 50）凭空胜过「真实走平 0%」（0 分），
  // 而查不到现货对的恰恰是流动性最差的那批，叠加「市值查不到=100 分」，
  // 整个筛选器在结构性地偏爱它最不了解的币。新曲线让走平和未知都落在中性 50。
  it("24h 动量方向 10%：signed<=-15 =0，[-15,0) 线性 0→50，走平=50，(0,3] 线性 50→100，(3,15] 线性 100→0，>15 =0；多头 signed=change24h", () => {
    // 固定：市值1.0 振幅1.0 资金费率0.5 OI1.0 位置1.0 → 80 + 10*momSub

    // change24h=-20（负向范围外）→ momSub=0 → 80
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": -20 })).toBe(80);

    // change24h=-15（负向下沿拐点）→ momSub=0 → 80
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": -15 })).toBe(80);

    // change24h=-7.5（负半段中点）→ momSub=(50+(-7.5/15)*50)/100=0.25 → 80+2.5=82.5 -> 83
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": -7.5 })).toBe(83);

    // change24h=0（走平）→ momSub=0.5（中性，两个分支在这里必须给同一个值）→ 80+5=85
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 0 })).toBe(85);

    // change24h=1.5（上升段中点）→ momSub=(50+(1.5/3)*50)/100=0.75 → 80+7.5=87.5 -> 88
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 1.5 })).toBe(88);

    // change24h=3（峰值，两个分支在这里必须都给 100）→ momSub=1.0 → 80+10=90
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 3 })).toBe(90);

    // change24h=9（下降段中点）→ momSub=1-(9-3)/12=0.5 → 80+5=85
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 9 })).toBe(85);

    // change24h=15（上沿拐点，同时也是 hardFilter 的多头存活上限）→ momSub=0 → 80
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 15 })).toBe(80);

    // change24h 未知（X-USDT 不在 change24hMap 里，即关联不到现货交易对）→
    // momentumScore 中性分支返回 50 → momSub=0.5 → 80+5=85，与走平完全相同。
    expect(scoreOf({})).toBe(85);

    // 三条关键不等式，把曲线的方向性钉死（逆向 < 走平 = 未知 < 峰值）：
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": -7.5 })).toBeLessThan(
      scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 0 })
    );
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 0 })).toBe(scoreOf({}));
    expect(scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 0 })).toBeLessThan(
      scoreOf({}, 50_000_000, 0, {}, { "X-USDT": 3 })
    );
  });

  it("趋势位置 10%：eff∈[0.2,0.5] 平台=100，<0.2 线性 0→100，>0.5 线性 100→0；多头 eff=(last-low)/(high-low)", () => {
    // 固定：市值1.0 振幅1.0 资金费率0.5 OI1.0 动量0.5(未知,中性) → 75 + 10*posSub
    // high=1030,low=1000,range=30；last = low + eff*30

    // eff=0（last=low，极端低位）→ posSub=0 → 75
    expect(scoreOf({ lastPrice: "1000" })).toBe(75);

    // eff=0.1（下沿线性段中点）→ posSub=0.1/0.2=0.5 → 75+5=80
    expect(scoreOf({ lastPrice: "1003" })).toBe(80);

    // eff=0.2（下沿拐点，平台起点）→ posSub=1.0 → 85
    expect(scoreOf({ lastPrice: "1006" })).toBe(85);

    // eff=0.5（上沿拐点，平台终点）→ posSub=1.0 → 85
    expect(scoreOf({ lastPrice: "1015" })).toBe(85);

    // eff=0.75（上沿线性段中点）→ posSub=1-(0.75-0.5)/0.5=0.5 → 75+5=80
    expect(scoreOf({ lastPrice: "1022.5" })).toBe(80);

    // eff=1（last=high，极端高位）→ posSub=0 → 75
    expect(scoreOf({ lastPrice: "1030" })).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// 方向不对称性：hardFilter 的追涨/追跌不对称、fundingScore 的费率反转已有覆盖。
// 这里补上另外两处方向相关的符号翻转 —— momentumScore 和 positionScore ——
// 此前完全没有测试碰过它们；把符号翻转删掉或反转，全部 26 个原有测试仍然会通过。
describe("direction asymmetry not covered by existing tests", () => {
  it("momentumScore inverts sign with direction: a long-favoring mover ranks first in groups.long, a short-favoring mover ranks first in groups.short", () => {
    // change24h 现在通过 change24hMap 传入（模拟现货 24h 涨跌关联结果），不再来自
    // ticker 自身的 priceChangePercent。
    // A: change24h=-3 → 多头 signed=-3(负半段, momSub=(50-3/15*50)/100=0.4)；空头 signed=3(峰值, momSub=1.0)
    // B: change24h=+3 → 多头 signed=3(峰值, momSub=1.0)；空头 signed=-3(负半段, momSub=0.4)
    // 其余维度对 A、B 完全一致：市值(map 里没有 A/B，capSub=1.0)、振幅(amp=3,ampSub=1.0)、
    // 资金费率(rate=0,fundSub=0.5)、OI(ratio=1.0,oiSub=1.0)。
    // 但 position 依赖同一个 lastPrice=1009，多空方向不同会翻转 eff，所以两个方向的总分
    // 基准不同，这里直接用手算好的总分而不是复用振幅测试里的基准：
    //   多头 position: eff=(1009-1000)/30=0.3（平台内，posSub=1.0）
    //   空头 position: eff=1-0.3=0.7（下降段，posSub=1-(0.7-0.5)/0.5=0.6）
    // A 多头 = 25+20+10+15+10*0.4+10*1.0 = 84（新曲线下逆向 -3% 不再是 0 分，旧值 80）
    // B 多头 = 25+20+10+15+10*1.0+10*1.0 = 90（未变）
    // A 空头 = 25+20+10+15+10*1.0+10*0.6 = 86（未变）
    // B 空头 = 25+20+10+15+10*0.4+10*0.6 = 80（新曲线下逆向 -3% 不再是 0 分，旧值 76）
    //
    // 改成按方向分差排序后，这四个分决定的不再是"谁在组里排前面"，而是"谁有资格进组"：
    //   A 做多差值 = 84 - 86 = -2 → A 进不了做多组（它其实是个偏空的币）
    //   B 做多差值 = 90 - 80 = +10 → 做多组只剩 B
    //   A 做空差值 = 86 - 84 = +2 → 做空组只剩 A
    //   B 做空差值 = 80 - 90 = -10 → B 进不了做空组
    // 方向翻转被删掉或反转时，两组会立刻换人或塌空，比原来的顺序断言更硬。
    const A = ticker({
      symbol: "MOMA-USDT",
      lowPrice: "1000",
      highPrice: "1030",
      lastPrice: "1009",
      quoteVolume: "50000000",
    });
    const B = ticker({
      symbol: "MOMB-USDT",
      lowPrice: "1000",
      highPrice: "1030",
      lastPrice: "1009",
      quoteVolume: "50000000",
    });
    const oi = { "MOMA-USDT": 50_000_000, "MOMB-USDT": 50_000_000 };
    const fr = { "MOMA-USDT": 0, "MOMB-USDT": 0 };
    const change24h = { "MOMA-USDT": -3, "MOMB-USDT": 3 };
    const groups = computeScreenerGroups([A, B], oi, fr, {}, change24h);

    expect(groups.long.map((r) => r.symbol)).toEqual(["MOMB-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([90]);
    expect(groups.long.map((r) => r.edge)).toEqual([10]);

    expect(groups.short.map((r) => r.symbol)).toEqual(["MOMA-USDT"]);
    expect(groups.short.map((r) => r.score)).toEqual([86]);
    expect(groups.short.map((r) => r.edge)).toEqual([2]);
  });

  it("positionScore inverts sign with direction: a low-in-range coin ranks first in groups.long, a high-in-range coin ranks first in groups.short", () => {
    // 不传 change24hMap，A、B 都关联不到 24h 涨跌 → momentumScore 中性分支恒返回 50，
    // 在多空两个方向上都是同一个值（不像已知值那样会随方向翻转），这样就把动量维度的
    // 方向翻转完全排除在外，只测 position 自己的符号翻转；它给两个方向都均匀加上 10*0.5=5。
    // A: lastPrice=1003 → eff_long=(1003-1000)/30=0.1(<0.2,posSub=0.5)；eff_short=1-0.1=0.9(>0.5,posSub=0.2)
    // B: lastPrice=1027 → eff_long=(1027-1000)/30=0.9(>0.5,posSub=0.2)；eff_short=1-0.9=0.1(<0.2,posSub=0.5)
    // 其余维度对 A、B 一致：市值capSub=1.0，振幅(amp=3)ampSub=1.0，资金费率(rate=0)fundSub=0.5，
    // OI(ratio=1.0)oiSub=1.0，动量momSub=0.5(未知,中性)。
    // A 多头 = 25+20+10+15+5+10*0.5 = 80
    // B 多头 = 25+20+10+15+5+10*0.2 = 77
    // A 空头 = 25+20+10+15+5+10*0.2 = 77
    // B 空头 = 25+20+10+15+5+10*0.5 = 80
    //
    // 按方向分差排序后，position 是这里唯一的方向来源，差值就完全由它决定：
    //   A 做多差值 = 80 - 77 = +3 → 只有 A 进做多组；B 做多差值 = -3，进不去
    //   B 做空差值 = 80 - 77 = +3 → 只有 B 进做空组；A 做空差值 = -3，进不去
    const A = ticker({
      symbol: "POSA-USDT",
      lowPrice: "1000",
      highPrice: "1030",
      lastPrice: "1003",
      quoteVolume: "50000000",
    });
    const B = ticker({
      symbol: "POSB-USDT",
      lowPrice: "1000",
      highPrice: "1030",
      lastPrice: "1027",
      quoteVolume: "50000000",
    });
    const oi = { "POSA-USDT": 50_000_000, "POSB-USDT": 50_000_000 };
    const fr = { "POSA-USDT": 0, "POSB-USDT": 0 };
    const groups = computeScreenerGroups([A, B], oi, fr, {});

    expect(groups.long.map((r) => r.symbol)).toEqual(["POSA-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([80]);
    expect(groups.long.map((r) => r.edge)).toEqual([3]);

    expect(groups.short.map((r) => r.symbol)).toEqual(["POSB-USDT"]);
    expect(groups.short.map((r) => r.score)).toEqual([80]);
    expect(groups.short.map((r) => r.edge)).toEqual([3]);
  });
});
