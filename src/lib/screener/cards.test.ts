import { describe, it, expect } from "vitest";
import { buildCard, memoKey, ignitionMemoKey, sortCards, extremesSince, signedPct } from "./cards";
import type { AlertCardData, ScenarioMemo } from "./cards";
import type { Scenario } from "./factors/scenario";
import type { Ignition } from "./ignition";
import type { ScannerRow } from "./types";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

const T0 = 1_700_000_000_000;

function scenario(o: Partial<Scenario> = {}): Scenario {
  return {
    kind: "a1_healthy_pullback",
    direction: "long",
    trap: false,
    strength: "trend_best",
    triggeredAt: 0,
    invalidation: { price: 100, breach: "below" },
    structureLevel: 100,
    cvdPct: 5,
    oiPct: 3,
    oiState: "up",
    ...o,
  };
}

function ignition(o: Partial<Ignition> = {}): Ignition {
  return {
    direction: "up",
    level: 100,
    invalidationPrice: 98,
    distancePct: 2,
    ignitedAt: T0 - 3_600_000,
    barsAgo: 2,
    volumeRatio: 2,
    oiChangePct: 1.5,
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
    ignition: null,
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
    const a = memoKey("TIA-USDT", scenario({ triggeredAt: 110 }));
    const b = memoKey("TIA-USDT", scenario({ triggeredAt: 111 }));
    expect(a).not.toBe(b);
  });

  it("锚点没变就是同一件事——币掉出前 20 再回来，首次价能接上", () => {
    expect(memoKey("TIA-USDT", scenario())).toBe(memoKey("TIA-USDT", scenario()));
  });

  it("同一个币的不同场景/不同方向互不混淆", () => {
    const a = memoKey("TIA-USDT", scenario({ kind: "a1_healthy_pullback", direction: "long" }));
    const b = memoKey("TIA-USDT", scenario({ kind: "b1_healthy_bounce", direction: "short" }));
    expect(a).not.toBe(b);
  });
});

describe("buildCard", () => {
  it("没场景就没有卡", () => {
    expect(
      buildCard({ row: row({ scenario: null, ignition: null }), priceBars: [], memo: undefined, now: T0 }).card
    ).toBeNull();
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



  it("失效判定不在这里做——它在流水线的行级，失效的场景根本走不到这儿", () => {
    // 两处各判一次、且窗口不同，正是这次要修的 bug：主扫描表显示
    // 「存量清算」而警报卡是空的。现在唯一的判据是 scenarioInvalidated
    // （见 invalidation.test.ts），这里只负责把 invalidationLine 算出来给
    // 卡片显示。传一段早已穿线的 K 线进来，卡片照样要出。
    const memo: ScenarioMemo = {
      key: memoKey("TIA-USDT", scenario()),
      symbol: "TIA-USDT",
      firstSeenAt: new Date(T0 - 3_600_000).toISOString(),
      firstPrice: 105,
    };
    const b = bars([[T0 - 1_800_000, 106, 50]]); // 远远跌破 swingPrev(100)
    const card = buildCard({ row: row(), priceBars: b, memo, now: T0 }).card;
    expect(card).not.toBeNull();
    expect(card!.invalidation).toEqual({ price: 100, breach: "below" });
  });

  it("首次之前的 K 线不参与峰值计算", () => {
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
    const sc = scenario({ kind: "b2_distrib_top_div", direction: "short" });
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
  const card = (symbol: string, total: number): AlertCardData => ({
    key: symbol,
    symbol,
    coin: symbol,
    trigger: { type: "scenario", scenario: scenario() },
    direction: "long",
    factors: { oi: 0, cvd: 0 },
    total,
    firstSeenAt: "",
    firstPrice: 1,
    peakPct: 0,
    invalidation: null,
    expired: false,
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

/**
 * 点火卡这一路。它现在是警报栏里的主力——选币翻成「最安静」之后六场景
 * 几乎判不出来（安静的币不创新极值，实测过门率 8% vs 最吵那组的 48%），
 * 线上表现是场景数从每天 8–26 个掉到 0。这几条把点火卡的关键行为钉死。
 */
describe("buildCard —— 点火卡", () => {
  it("没场景但有点火 = 出点火卡，向上突破对应做多", () => {
    const r = buildCard({
      row: row({ scenario: null, ignition: ignition() }),
      priceBars: [],
      memo: undefined,
      now: T0,
    });
    expect(r.card?.trigger.type).toBe("ignition");
    expect(r.card?.direction).toBe("long");
  });

  it("向下突破对应做空", () => {
    const r = buildCard({
      row: row({ scenario: null, ignition: ignition({ direction: "down", level: 120 }) }),
      priceBars: [],
      memo: undefined,
      now: T0,
    });
    expect(r.card?.direction).toBe("short");
  });

  it("卡片上的失效价用 invalidationPrice，不是被突破的那条边界", () => {
    // 边界本身太近了：773 个真实事件里点火当下离边界的距离中位只有 0.38%，
    // 61% 在 0.5% 以内。照那个位置判，84% 会被打穿。
    const up = buildCard({
      row: row({ scenario: null, ignition: ignition({ direction: "up", level: 100, invalidationPrice: 98 }) }),
      priceBars: [],
      memo: undefined,
      now: T0,
    }).card!;
    expect(up.invalidation).toEqual({ price: 98, breach: "below" });

    const down = buildCard({
      row: row({
        scenario: null,
        ignition: ignition({ direction: "down", level: 120, invalidationPrice: 122 }),
      }),
      priceBars: [],
      memo: undefined,
      now: T0,
    }).card!;
    expect(down.invalidation).toEqual({ price: 122, breach: "above" });
  });

  it("场景优先于点火——两个都有时只出场景卡，不出两张", () => {
    // 场景把资金流与持仓也说清楚了，是严格更多的信息；同一个币出两张卡
    // 只会让人以为是两个独立信号。
    const r = buildCard({
      row: row({ scenario: scenario(), ignition: ignition() }),
      priceBars: [],
      memo: undefined,
      now: T0,
    });
    expect(r.card?.trigger.type).toBe("scenario");
  });

  it("钥匙锚在点火时刻，level 变了也是同一张卡", () => {
    // 回看窗口每走一根就往前滚一格，level 会跟着变。如果钥匙里含 level，
    // 同一次点火每半小时换一把钥匙——卡片的首次价与计时每轮重置，
    // 「累计 / 峰值」永远是 0，警报栏里全是「刚刚触发」。
    const a = ignitionMemoKey("TIA-USDT", ignition({ level: 100 }));
    const b = ignitionMemoKey("TIA-USDT", ignition({ level: 103 }));
    expect(a).toBe(b);
  });

  it("不同的点火时刻是不同的事件——盘整之后再次突破要重新计时", () => {
    const a = ignitionMemoKey("TIA-USDT", ignition({ ignitedAt: T0 }));
    const b = ignitionMemoKey("TIA-USDT", ignition({ ignitedAt: T0 + 1_800_000 }));
    expect(a).not.toBe(b);
  });

  it("点火卡与场景卡的钥匙不会撞车", () => {
    expect(ignitionMemoKey("TIA-USDT", ignition())).not.toBe(memoKey("TIA-USDT", scenario()));
  });
});

describe("新出的卡不带 expired 标记", () => {
  it("buildCard 产出的一律是活卡——expired 只由流水线接上一轮时才置上", () => {
    // 写反的话，刚判出来的信号会被当成「已结束」灰掉，而且不会报错。
    const r = buildCard({ row: row(), priceBars: [], memo: undefined, now: T0 });
    expect(r.card?.expired).toBe(false);
  });
});
