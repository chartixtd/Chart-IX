import { describe, it, expect } from "vitest";
import { buildScanTargets } from "./pipeline";
import { SERVER_GATE } from "./universe";
import { QUIET_RANK_TAKE } from "./types";
import type { PreselectCandidate } from "./universe";
import type { CachedVolume } from "./volume-cache";
import type { BingXTicker } from "@/types/bingx";

function candidate(coin: string): PreselectCandidate {
  return { bingxSymbol: `${coin}-USDT`, coin, marketCap: 1e8, marketCapRank: 200 };
}

function ticker(coin: string, high: number, low: number, last = 10): BingXTicker {
  return {
    symbol: `${coin}-USDT`,
    openPrice: String(low),
    highPrice: String(high),
    lowPrice: String(low),
    lastPrice: String(last),
    volume: "1",
    quoteVolume: "1",
    priceChange: "0",
    priceChangePercent: "1.5",
    closeTime: 0,
  };
}

const OK_VOL = SERVER_GATE.minVolumeUsd;
const vol = (v: number): CachedVolume => ({ volumeUsd: v, updatedAt: 1 });

function build(specs: Array<{ coin: string; amp: number; volumeUsd?: number | null }>) {
  const cands = specs.map((s) => candidate(s.coin));
  const tickers = new Map(
    specs.map((s) => [`${s.coin}-USDT`, ticker(s.coin, 100 * (1 + s.amp / 100), 100)])
  );
  const cache = new Map<string, CachedVolume>();
  for (const s of specs) {
    if (s.volumeUsd !== null) cache.set(s.coin, vol(s.volumeUsd ?? OK_VOL));
  }
  return buildScanTargets(cands, tickers, cache);
}

describe("buildScanTargets", () => {
  it("按振幅从低到高取——挑最安静的，不是最吵的", () => {
    // 方向是反的，而且是实测逼出来的：高振幅档捕获率只有 33%、六成情况
    // 回吐大于延续；低振幅档捕获率 56%、延续是回吐的 3.5 倍。叠加点火后
    // 差距更极端（延续占比 85% vs 21%）。完整数据见 types.ts 的
    // QUIET_RANK_TAKE 注释。
    //
    // 这条用例是这次改动的核心断言——写反了不会报错，只会让整个扫描器
    // 悄悄退回「专挑已经跑完的币」，而榜单看上去一切正常。
    const out = build([
      { coin: "LOUD", amp: 30 },
      { coin: "QUIET", amp: 2 },
      { coin: "MID", amp: 10 },
    ]);
    expect(out.map((t) => t.candidate.coin)).toEqual(["QUIET", "MID", "LOUD"]);
  });

  it("成交量不达标的直接排除", () => {
    const out = build([
      { coin: "RICH", amp: 5, volumeUsd: OK_VOL },
      { coin: "THIN", amp: 99, volumeUsd: OK_VOL - 1 },
    ]);
    // THIN 振幅高得多，但流动性不达标——排名再高也不该进
    expect(out.map((t) => t.candidate.coin)).toEqual(["RICH"]);
  });

  it("缓存里查不到成交量的一律排除，不是当作 0 也不是放行", () => {
    // 「必须证明达标」——查不到就证明不了。放行会让一个流动性未知的币
    // 凭高振幅直接占掉一个深度扫描名额。
    const out = build([
      { coin: "KNOWN", amp: 5 },
      { coin: "UNKNOWN", amp: 99, volumeUsd: null },
    ]);
    expect(out.map((t) => t.candidate.coin)).toEqual(["KNOWN"]);
  });

  it("最多取 QUIET_RANK_TAKE 个", () => {
    const specs = Array.from({ length: QUIET_RANK_TAKE + 7 }, (_, i) => ({
      coin: `C${String(i).padStart(2, "0")}`,
      amp: i + 1,
    }));
    expect(build(specs)).toHaveLength(QUIET_RANK_TAKE);
  });

  it("振幅并列时按 symbol 排，结果可复现", () => {
    const a = build([{ coin: "BBB", amp: 7 }, { coin: "AAA", amp: 7 }]);
    expect(a.map((t) => t.candidate.coin)).toEqual(["AAA", "BBB"]);
  });

  it("价格非法的币跳过——没有价格就没有可下单的行", () => {
    const cands = [candidate("BAD")];
    const tickers = new Map([["BAD-USDT", ticker("BAD", 110, 100, 0)]]);
    expect(buildScanTargets(cands, tickers, new Map([["BAD", vol(OK_VOL)]]))).toHaveLength(0);
  });

  it("成交量恰好等于门槛时放行（门槛是 ≥ 不是 >）", () => {
    expect(build([{ coin: "EDGE", amp: 5, volumeUsd: OK_VOL }])).toHaveLength(1);
  });
});
