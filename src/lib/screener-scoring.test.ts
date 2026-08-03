import { describe, it, expect } from "vitest";
import {
  hardFilter,
  isExcludedByMarketCap,
  isSyntheticProduct,
  selectCandidateSymbols,
  computeScreenerGroups,
  buildChange24hMap,
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
    expect(hardFilter(ticker({ symbol: "WIF-USDT" }), "long", undefined)).toBe(false);
  });

  it("drops coins below the volume floor", () => {
    expect(hardFilter(ticker({ symbol: "DUST-USDT", quoteVolume: "500000" }), "long", undefined)).toBe(true);
  });

  // 门槛已从 1M 提到 5M（流动性现在是纯门槛，没有任何打分维度再补偿它）。
  // 500,000 在新旧两个门槛下都会被淘汰，分不出区别；这一对样本卡在 1M 与 5M 之间，
  // 只有门槛真的是 5M 才会淘汰 2M 那个、同时保留 6M 那个。
  it("drops a coin that would have cleared the old 1M floor but sits below the 5M floor", () => {
    expect(hardFilter(ticker({ symbol: "THIN-USDT", quoteVolume: "2000000" }), "long", undefined)).toBe(true);
  });

  it("keeps a coin whose volume clears the 5M floor", () => {
    expect(hardFilter(ticker({ symbol: "LIQUID-USDT", quoteVolume: "6000000" }), "long", undefined)).toBe(false);
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

  // 之前这里是 `expect([...scores].sort()).toEqual(scores)` —— 对自身重新排序再比较，
  // 任何实现（包括给所有币打相同分的实现）都能通过，没有信号。改成断言具体的、
  // 可独立算出的排序结果：三条振幅不同、其余五个维度锁定一致的行情，
  // 振幅子分应为 3(amp=3,峰值,100) > 8.5(amp=8.5,下降段中点,50) > 1.5(amp=1.5,下降段起点,0)。
  // 没有传 change24hMap，三个 symbol 都关联不到 24h 涨跌 → 动量维度统一拿中性 50 分
  // （0.1*50=5，而不是旧版靠 priceChangePercent 锁定的 0.1*100=10），
  // 其余四个维度锁定分之和为 25(市值,查不到→100)+10(资金费率,rate=0→50)+15(OI,ratio=1.0→100)+10(位置,eff=0.3→100)=60，
  // 加上动量 5 = 65，再加振幅 20*ampSub：
  // 对应总分 85(振幅100) > 75(振幅50) > 65(振幅0)（算法见下面 "amplitude" 维度测试块的注释）。
  it("sorts each group by descending score using an independently-computable ordering", () => {
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
    expect(groups.long.map((r) => r.symbol)).toEqual(["ORD-MID-USDT", "ORD-HIGH-USDT", "ORD-LOW-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([85, 75, 65]);
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

    expect(groups.long.map((r) => r.symbol)).toEqual(["HASOI-USDT", "NOOI-USDT", "ZEROOI-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([85, 78, 70]);

    const noOi = groups.long[1];
    expect(noOi.openInterest).toBeNull();
    expect(noOi.oiVolumeRatio).toBeNull();
    // 对照：真的是 0 的那个仍然报 0，不是 null——两种情况没有被混为一谈
    expect(groups.long[2].openInterest).toBe(0);
    expect(groups.long[2].oiVolumeRatio).toBe(0);
  });

  // priceChangePercent 现在是查表结果，不是 ticker 自身的字段：查不到就是 null
  // （表格据此显示 "-"），查得到就是现货的真实 24h 涨跌。
  // 生产环境实测的失败场景：代币化股票（如 NCSKTSLA2USD，即 Tesla）在 CoinGecko
  // 查不到市值，走「查不到=微型盘」分支白拿 25% 权重的满分（100），量能刚过门槛，
  // 振幅 ~2.5% 又落在打分甜点区，结果比真实小市值币分还高，顶到榜首。
  // 量能取 12M 而不是实测的 1.2M：门槛提到 5M 之后 1.2M 会先被成交量淘汰，
  // 那样这条断言就成了空转，证明不了前缀排除本身有效。
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
  function scoreOf(
    overrides: Partial<BingXTicker>,
    oi = 50_000_000,
    fr = 0,
    marketCapMap: MarketCapMap | null = {},
    change24hMap: Record<string, number> = {}
  ) {
    const t = ticker({ symbol: "X-USDT", ...REF, ...overrides });
    const groups = computeScreenerGroups([t], { "X-USDT": oi }, { "X-USDT": fr }, marketCapMap, change24hMap);
    expect(groups.long).toHaveLength(1); // 前置断言：确认没有被 hardFilter 误杀
    return groups.long[0].score;
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

    expect(groups.long.map((r) => r.symbol)).toEqual(["MOMB-USDT", "MOMA-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([90, 84]);

    expect(groups.short.map((r) => r.symbol)).toEqual(["MOMA-USDT", "MOMB-USDT"]);
    expect(groups.short.map((r) => r.score)).toEqual([86, 80]);
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

    expect(groups.long.map((r) => r.symbol)).toEqual(["POSA-USDT", "POSB-USDT"]);
    expect(groups.long.map((r) => r.score)).toEqual([80, 77]);

    expect(groups.short.map((r) => r.symbol)).toEqual(["POSB-USDT", "POSA-USDT"]);
    expect(groups.short.map((r) => r.score)).toEqual([80, 77]);
  });
});
