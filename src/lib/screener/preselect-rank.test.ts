import { describe, it, expect } from "vitest";
import { liquidationAnomaly, rankForDeepScan, LIQ_ANOMALY_FLOOR_USD } from "./preselect-rank";
import type { RankInput } from "./preselect-rank";
import type { PreselectCandidate } from "./universe";

function candidate(symbol: string): PreselectCandidate {
  return {
    bingxSymbol: symbol,
    coin: symbol.replace("-USDT", ""),
    marketCap: 100_000_000,
    marketCapRank: 200,
  };
}

function input(symbol: string, amplitude: number, liq1h: number, liq24h: number): RankInput {
  return { candidate: candidate(symbol), amplitude, liq1h, liq24h };
}

describe("liquidationAnomaly", () => {
  it("liq24h === 0 时不返回 Infinity", () => {
    const anomaly = liquidationAnomaly(500, 0);
    expect(Number.isFinite(anomaly)).toBe(true);
    expect(anomaly).toBe(500 / LIQ_ANOMALY_FLOOR_USD);
  });

  it("非有限值输入（NaN/Infinity）返回 0", () => {
    expect(liquidationAnomaly(NaN, 1000)).toBe(0);
    expect(liquidationAnomaly(500, Infinity)).toBe(0);
    expect(liquidationAnomaly(Infinity, 1000)).toBe(0);
  });

  it("24h 均摊值低于下限时，用下限当分母，不让小额爆仓算出天文倍数", () => {
    // liq24h/24 = 240/24 = 10，远小于 1000 的下限，分母应取下限 1000
    expect(liquidationAnomaly(2000, 240)).toBeCloseTo(2000 / LIQ_ANOMALY_FLOOR_USD);
  });

  it("24h 均摊值高于下限时，用均摊值当分母", () => {
    // liq24h/24 = 240000/24 = 10000，高于下限，分母应取 10000
    expect(liquidationAnomaly(20000, 240000)).toBeCloseTo(2);
  });
});

describe("rankForDeepScan", () => {
  it("恰好返回 limit 个", () => {
    const inputs = Array.from({ length: 5 }, (_, i) => input(`C${i}-USDT`, i, i * 10, i * 100));
    expect(rankForDeepScan(inputs, 3)).toHaveLength(3);
  });

  it("候选不足 limit 时返回全部", () => {
    const inputs = [input("A-USDT", 1, 10, 10), input("B-USDT", 2, 20, 20)];
    expect(rankForDeepScan(inputs, 15)).toHaveLength(2);
  });

  it("同分时按 bingxSymbol 字典序稳定排序", () => {
    const inputs = [
      input("Z-USDT", 5, 100, 100),
      input("A-USDT", 5, 100, 100),
      input("M-USDT", 5, 100, 100),
    ];
    const ranked = rankForDeepScan(inputs, 3);
    expect(ranked.map((c) => c.bingxSymbol)).toEqual(["A-USDT", "M-USDT", "Z-USDT"]);
  });

  it("百分位归一让「爆仓极大但振幅垫底」与「振幅极大但爆仓垫底」的两个币拿到相近总分", () => {
    // 只有两个候选、两者的爆仓与振幅正好互换极值：
    // A 爆仓遥遥领先、振幅垫底；B 振幅遥遥领先、爆仓垫底。
    // 百分位下 A = 0.5*1 + 0.5*0 = 0.5，B = 0.5*0 + 0.5*1 = 0.5，应该打平。
    const inputs = [input("A-USDT", 0.1, 5_000_000, 2_000_000), input("B-USDT", 50, 10, 5)];
    const ranked = rankForDeepScan(inputs, 2);
    // 打平之后应按 symbol 字典序排列，而不是被某一维的绝对值大小决定顺序
    expect(ranked.map((c) => c.bingxSymbol)).toEqual(["A-USDT", "B-USDT"]);
  });

  it("爆仓信号整体拿不到（liq1h/liq24h 全 0）时退化成只按振幅排，不按数组原始顺序伪造坡度", () => {
    // 模拟 liquidation/coin-list 整体失败后 pipeline.ts 的降级填法：
    // 所有候选的 liq1h/liq24h 都填 0，爆仓异常度因此完全相等。
    // 如果百分位算法按数组原始位置分别摊名次（而不是并列取平均），
    // 排在数组末尾的候选会被错误地分到更高的爆仓百分位，
    // 振幅明明更小却能排到振幅更大的候选前面——这里反着摆放振幅
    // （数组顺序与振幅高低相反）来暴露这种伪造坡度。
    const inputs = [
      input("LOW-USDT", 1, 0, 0), // 数组里排第一，但振幅最小
      input("MID-USDT", 5, 0, 0),
      input("HIGH-USDT", 10, 0, 0), // 数组里排最后，振幅最大
    ];
    const ranked = rankForDeepScan(inputs, 3);
    expect(ranked.map((c) => c.bingxSymbol)).toEqual(["HIGH-USDT", "MID-USDT", "LOW-USDT"]);
  });

  it("绝对值缩放会失败、百分位归一会通过的对比场景：爆仓额差 5 个数量级时振幅仍能影响排序", () => {
    // WHALE 的爆仓额比其他候选大 4-5 个数量级，但振幅垫底；
    // MID 的爆仓额很小（垫底），但振幅遥遥领先。
    // 如果用绝对值缩放（value / max），MID 的爆仓分量会被压成约等于 0，
    // 且振幅缩放同理压低其他候选，WHALE 会几乎独占爆仓维度、稳居前列，
    // MID 的振幅优势不足以把它顶进 limit=2 的名额。
    // 百分位归一下，MID 在振幅维度是满分、爆仓维度垫底但不为 0，
    // 综合分反而能超过只在爆仓维度突出、振幅垫底的 WHALE。
    const inputs = [
      input("WHALE-USDT", 0.1, 100_000_000, 50_000_000),
      input("MID-USDT", 10, 10, 5),
      input("LOW1-USDT", 0.2, 5, 2),
      input("LOW2-USDT", 0.3, 3, 1),
    ];
    const ranked = rankForDeepScan(inputs, 2);
    const symbols = ranked.map((c) => c.bingxSymbol);
    expect(symbols).toContain("MID-USDT");
    expect(symbols[0]).toBe("MID-USDT");
  });
});
