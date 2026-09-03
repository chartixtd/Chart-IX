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

/**
 * `comp` 是排序键（压缩度）。不给就用 amp 顶上——只是为了让「小的排前面」
 * 这一类断言写起来直观，跟真实语义无关：真实的压缩度是 6h振幅÷24h振幅。
 * `comp: null` 表示这个币在压缩度 Map 里查不到。
 */
function build(
  specs: Array<{ coin: string; amp: number; comp?: number | null; volumeUsd?: number | null }>
) {
  const cands = specs.map((s) => candidate(s.coin));
  const tickers = new Map(
    specs.map((s) => [`${s.coin}-USDT`, ticker(s.coin, 100 * (1 + s.amp / 100), 100)])
  );
  const cache = new Map<string, CachedVolume>();
  const compression = new Map<string, number>();
  for (const s of specs) {
    if (s.volumeUsd !== null) cache.set(s.coin, vol(s.volumeUsd ?? OK_VOL));
    if (s.comp !== null) compression.set(`${s.coin}-USDT`, s.comp ?? s.amp);
  }
  return buildScanTargets(cands, tickers, cache, compression);
}

describe("buildScanTargets", () => {
  it("按压缩度从小到大取——6h 振幅相对 24h 越小越靠前", () => {
    // 方向写反不会报错，只会让整个扫描器悄悄改成「专挑正在放开的币」，
    // 而榜单看上去一切正常，所以这条断言必须在。
    //
    // **留个记录**：实测数据不支持用压缩度当排序键。50 个币 / 528 个不重叠
    // 时点 / 84 次点火：只要点火不做选币，延续占比 82%；压缩比筛过反而降到
    // 59%；而 24h 振幅最低 1/3 是 85%。这是按要求改的，不是数据选出来的。
    const out = build([
      { coin: "LOOSE", amp: 1, comp: 0.9 },
      { coin: "TIGHT", amp: 1, comp: 0.1 },
      { coin: "MID", amp: 1, comp: 0.5 },
    ]);
    expect(out.map((t) => t.candidate.coin)).toEqual(["TIGHT", "MID", "LOOSE"]);
  });

  it("压缩度查不到的币排除——没有排序键就没法排队", () => {
    // 跟量能比刻意相反：量能比是否决门，算不出来不拦；压缩度是排序键，
    // 缺了就只能给它编一个名次。
    const out = build([
      { coin: "HAS", amp: 5 },
      { coin: "MISSING", amp: 1, comp: null },
    ]);
    expect(out.map((t) => t.candidate.coin)).toEqual(["HAS"]);
  });

  it("成交量不达标的直接排除", () => {
    const out = build([
      { coin: "RICH", amp: 5, volumeUsd: OK_VOL },
      { coin: "THIN", amp: 99, volumeUsd: OK_VOL - 1 },
    ]);
    // THIN 排在前面，但流动性不达标——排名再高也不该进
    expect(out.map((t) => t.candidate.coin)).toEqual(["RICH"]);
  });

  it("缓存里查不到成交量的一律排除，不是当作 0 也不是放行", () => {
    // 「必须证明达标」——查不到就证明不了。放行会让一个流动性未知的币
    // 凭排名直接占掉一个深度扫描名额。
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

  it("压缩度并列时按 symbol 排，结果可复现", () => {
    const a = build([{ coin: "BBB", amp: 7 }, { coin: "AAA", amp: 7 }]);
    expect(a.map((t) => t.candidate.coin)).toEqual(["AAA", "BBB"]);
  });

  it("价格非法的币跳过——没有价格就没有可下单的行", () => {
    const cands = [candidate("BAD")];
    const tickers = new Map([["BAD-USDT", ticker("BAD", 110, 100, 0)]]);
    expect(
      buildScanTargets(cands, tickers, new Map([["BAD", vol(OK_VOL)]]), new Map([["BAD-USDT", 0.2]]))
    ).toHaveLength(0);
  });

  it("成交量恰好等于门槛时放行（门槛是 ≥ 不是 >）", () => {
    expect(build([{ coin: "EDGE", amp: 5, volumeUsd: OK_VOL }])).toHaveLength(1);
  });
});
