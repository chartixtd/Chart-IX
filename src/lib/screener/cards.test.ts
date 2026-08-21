import { describe, it, expect } from "vitest";
import { buildCard, memoKey, sortCards, extremesSince, signedPct } from "./cards";
import type { ScenarioCard, ScenarioMemo } from "./cards";
import type { Scenario } from "./factors/scenario";
import type { ScannerRow } from "./types";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

const T0 = 1_700_000_000_000;

function scenario(o: Partial<Scenario> = {}): Scenario {
  return {
    kind: "healthy_trend",
    direction: "long",
    trap: false,
    swingPrev: 100,
    swingNow: 110,
    cvdPct: 5,
    oiPct: 3,
    side: "high",
    ...o,
  };
}

function row(o: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 55,
    factors: { oi: 40, cvd: 15 },
    dataGaps: [],
    scenario: scenario(),
    price: 108,
    change24h: 1,
    amplitude: 12,
    volumeUsd: 5e7,
    marketCap: 1e8,
    marketCapRank: 200,
    fundingRate: null,
    sourceExchange: "BingX",
    ...o,
  };
}

/** 每根 30 分钟，high/low 显式给定 */
function bars(specs: Array<[number, number, number]>): CoinGlassPriceBar[] {
  return specs.map(([time, high, low]) => ({
    time,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(high),
    volume_usd: "1",
  }));
}

describe("memoKey", () => {
  it("锚点变了就是新事件——钥匙跟着变", () => {
    const a = memoKey("TIA-USDT", scenario({ swingNow: 110 }));
    const b = memoKey("TIA-USDT", scenario({ swingNow: 111 }));
    expect(a).not.toBe(b);
  });

  it("锚点没变就是同一件事——币掉出前 20 再回来，首次价能接上", () => {
    expect(memoKey("TIA-USDT", scenario())).toBe(memoKey("TIA-USDT", scenario()));
  });

  it("同一个币的不同侧/不同方向互不混淆", () => {
    const high = memoKey("TIA-USDT", scenario({ side: "high" }));
    const low = memoKey("TIA-USDT", scenario({ side: "low" }));
    expect(high).not.toBe(low);
  });
});

describe("buildCard", () => {
  it("没场景就没有卡", () => {
    expect(buildCard({ row: row({ scenario: null }), priceBars: [], memo: undefined, now: T0 }).card).toBeNull();
  });

  it("第一次看到：出卡，并要求新建备忘", () => {
    const r = buildCard({ row: row(), priceBars: [], memo: undefined, now: T0 });
    expect(r.card?.firstPrice).toBe(108);
    expect(r.newMemo?.key).toBe(memoKey("TIA-USDT", scenario()));
  });

  it("已有备忘：首次价用备忘的，不是当前价", () => {
    // 这正是备忘存在的全部意义——「累计变化」要从最早看到它的价位算起。
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 3_600_000).toISOString(),
      firstPrice: 100,
    };
    const r = buildCard({ row: row({ price: 108 }), priceBars: [], memo, now: T0 });
    expect(r.card?.firstPrice).toBe(100);
    expect(r.newMemo).toBeUndefined();
  });

  it("价格打穿失效线 → 没有卡", () => {
    // healthy_trend 高点侧的失效线在 swingPrev(100) 下方。
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 3_600_000).toISOString(),
      firstPrice: 105,
    };
    const b = bars([[T0 - 1_800_000, 106, 99]]); // 最低 99 < 100，穿了
    expect(buildCard({ row: row(), priceBars: b, memo, now: T0 }).card).toBeNull();
  });

  it("插针穿线也算——用区间最低价而不是收盘价", () => {
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 3_600_000).toISOString(),
      firstPrice: 105,
    };
    // 收盘回到 106（线内），但盘中插到 99
    const b = bars([[T0 - 1_800_000, 106, 99]]);
    expect(buildCard({ row: row(), priceBars: b, memo, now: T0 }).card).toBeNull();
  });

  it("首次之前的 K 线不参与失效判定", () => {
    // 卡是 T0 才第一次看到的，一小时前跌破过 100 跟这张卡无关。
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0).toISOString(),
      firstPrice: 108,
    };
    const b = bars([[T0 - 3_600_000, 106, 90]]); // 早于 firstSeenAt
    expect(buildCard({ row: row(), priceBars: b, memo, now: T0 }).card).not.toBeNull();
  });

  it("失效时仍然返回 newMemo——备忘必须落库，否则这张卡下一轮会原地复活", () => {
    // 不落库的话下一轮 firstSeenAt 重置成「现在」，失效判定只看得到
    // 刚才那几分钟的 K 线、判不出穿线，卡就又冒出来了。
    const b = bars([[T0, 106, 99]]);
    const r = buildCard({ row: row({ price: 99 }), priceBars: b, memo: undefined, now: T0 });
    expect(r.card).toBeNull();
    expect(r.newMemo).toBeDefined();
  });

  it("峰值从 K 线区间算，做多看最高价", () => {
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 3_600_000).toISOString(),
      firstPrice: 100,
    };
    const b = bars([[T0 - 1_800_000, 120, 101]]);
    // 最高到过 120 → +20%，虽然当前价只有 108
    expect(buildCard({ row: row({ price: 108 }), priceBars: b, memo, now: T0 }).card!.peakPct).toBeCloseTo(20);
  });

  it("做空的峰值看最低价，且符号翻过来", () => {
    const sc = scenario({ kind: "true_top_div", direction: "short" });
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", sc),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 3_600_000).toISOString(),
      firstPrice: 100,
    };
    // true_top_div 失效线在 swingNow(110) 上方，最高 109 没穿
    const b = bars([[T0 - 1_800_000, 109, 90]]);
    const card = buildCard({ row: row({ scenario: sc, price: 95 }), priceBars: b, memo, now: T0 }).card!;
    expect(card.peakPct).toBeCloseTo(10); // 跌到 90 = 做空 +10%
  });

  it("峰值不会是负数——没赚过就是 0，不是「最高到过 -3%」", () => {
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 1_800_000).toISOString(),
      firstPrice: 108,
    };
    const b = bars([[T0 - 900_000, 107, 101]]);
    expect(buildCard({ row: row({ price: 105 }), priceBars: b, memo, now: T0 }).card!.peakPct).toBe(0);
  });
});

describe("sortCards", () => {
  const card = (symbol: string, total: number): ScenarioCard => ({
    key: symbol,
    symbol,
    coin: symbol,
    scenario: scenario(),
    factors: { oi: 0, cvd: 0 },
    total,
    firstSeenAt: "",
    firstPrice: 1,
    peakPct: 0,
    invalidation: null,
  });

  it("总分高的在上——打开警报栏要问的是「现在最值得看哪个」", () => {
    expect(sortCards([card("A", 30), card("B", 70), card("C", 50)]).map((c) => c.symbol)).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("同分按 symbol，顺序稳定可复现", () => {
    expect(sortCards([card("B", 50), card("A", 50)]).map((c) => c.symbol)).toEqual(["A", "B"]);
  });
});

describe("extremesSince / signedPct", () => {
  it("只看 since 之后的 K 线", () => {
    const b = bars([
      [T0 - 3_600_000, 200, 50],
      [T0, 120, 100],
    ]);
    expect(extremesSince(b, T0)).toEqual({ high: 120, low: 100 });
  });

  it("一根都没有时返回 null，调用方用当前价代替", () => {
    expect(extremesSince(bars([[T0 - 1000, 1, 1]]), T0)).toBeNull();
  });

  it("做空时涨跌符号翻过来——跌了才是正的", () => {
    expect(signedPct(100, 90, "short")).toBeCloseTo(10);
    expect(signedPct(100, 90, "long")).toBeCloseTo(-10);
  });
});
