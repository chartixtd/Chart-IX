import { describe, it, expect } from "vitest";
import {
  buildCard,
  memoKey,
  ignitionMemoKey,
  sortCards,
  extremesSince,
  signedPct,
  advanceCards,
  refreshCard,
  triggerInvalidated,
} from "./cards";
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
  const T = 1_700_000_000_000;
  const card = (symbol: string, total: number, minutesAgo: number): AlertCardData => ({
    key: symbol,
    symbol,
    coin: symbol,
    trigger: { type: "scenario", scenario: scenario() },
    direction: "long",
    factors: { oi: 0, cvd: 0 },
    total,
    firstSeenAt: new Date(T - minutesAgo * 60_000).toISOString(),
    firstPrice: 1,
    peakPct: 0,
    invalidation: null,
    expired: false,
  });

  it("最新出现的在最上面", () => {
    const out = sortCards([card("A", 30, 120), card("B", 70, 10), card("C", 50, 60)]);
    expect(out.map((c) => c.symbol)).toEqual(["B", "C", "A"]);
  });

  it("分数不参与排序——一个 5 小时前的高分信号不如刚出的中分信号有用", () => {
    // 90 分但 5 小时前，vs 10 分但刚出来
    const out = sortCards([card("OLD", 90, 300), card("NEW", 10, 1)]);
    expect(out.map((c) => c.symbol)).toEqual(["NEW", "OLD"]);
  });

  it("同一刻出现的按 symbol，顺序稳定可复现", () => {
    expect(sortCards([card("B", 50, 5), card("A", 20, 5)]).map((c) => c.symbol)).toEqual(["A", "B"]);
  });

  it("不改原数组", () => {
    const input = [card("A", 10, 1), card("B", 10, 99)];
    sortCards(input);
    expect(input.map((c) => c.symbol)).toEqual(["A", "B"]);
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
 * 点火卡这一路。**它在生产上已经关掉了**（IGNITION_CARDS_ENABLED=false，
 * 理由见 cards.ts：捕获率 36–47%、止损止盈网格 20 格全负且全场最差），
 * 但判定逻辑保留着，所以这些用例照样要跑——传 `ignitionCards: true` 显式
 * 打开。「暂时关掉」不该等于「无人看管的坏代码」。
 */
describe("buildCard —— 点火卡（生产已关，逻辑保留）", () => {
  it("默认（跟生产一致）不出点火卡", () => {
    const r = buildCard({
      row: row({ scenario: null, ignition: ignition() }),
      priceBars: [],
      memo: undefined,
      now: T0,
    });
    expect(r.card).toBeNull();
  });

  it("显式打开后：没场景但有点火 = 出点火卡，向上突破对应做多", () => {
    const r = buildCard({
      row: row({ scenario: null, ignition: ignition() }),
      priceBars: [],
      memo: undefined,
      now: T0,
      ignitionCards: true,
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
      ignitionCards: true,
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
      ignitionCards: true,
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
      ignitionCards: true,
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
      ignitionCards: true,
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

/**
 * 灰卡（已结束但还留着）的三条筛选。
 *
 * 这组用例是线上问题逼出来的：初版只筛「不在当轮里」+「没过宽限期」，
 * 结果 21 张卡里 12 张是灰的，而绝大多数根本不是信号结束，是**卡片换了
 * 身份**——用户看到的现象是「价格离失效价还有 1%，卡片却显示已结束」。
 */
/**
 * 卡片的生命周期。**唯一的终点是价格碰到失效线。**
 *
 * 这组用例的原型是线上那张 OP 的 b3 卡：失效价 0.1135 是本波高点，之后
 * 没有一根 K 线的最高价超过它，价格离线还有 1.7%，卡却结束了——旧行为下
 * 卡片是「当轮扫描的视图」，场景一判不出来就没。现在它必须活着。
 */
describe("advanceCards", () => {
  const T = 1_700_000_000_000;
  const HOUR = 3_600_000;

  const card = (o: Partial<AlertCardData> & { key: string; symbol: string }): AlertCardData => ({
    coin: o.symbol.replace("-USDT", ""),
    trigger: { type: "scenario", scenario: scenario({ triggeredAt: T - 4 * HOUR }) },
    direction: "long",
    factors: { oi: 0, cvd: 0 },
    total: 10,
    firstSeenAt: new Date(T - 3 * HOUR).toISOString(),
    firstPrice: 110,
    peakPct: 0,
    invalidation: { price: 100, breach: "below" },
    expired: false,
    ...o,
  });

  /** 一段没碰到失效线（100）的 K 线 */
  const safe = bars([
    [T - 2 * HOUR, 115, 105],
    [T - HOUR, 114, 103],
  ]);
  /** 最后一根跌破了 100 */
  const broken = bars([
    [T - 2 * HOUR, 115, 105],
    [T - HOUR, 114, 99],
  ]);
  const noRows = new Map<string, ScannerRow>();

  it("场景已经判不出来了，只要没碰线，卡片照常活着", () => {
    // 这就是 OP 那张卡：这一轮扫到了这个币、K 线也在手上、价格离失效线还远，
    // 而本轮 rows 里根本没有它的场景。旧行为会让它消失。
    const c = card({ key: "k1", symbol: "OP-USDT" });
    const out = advanceCards({
      previous: [c],
      bars: new Map([["OP-USDT", safe]]),
      rows: noRows,
      now: T,
    });
    expect(out.live).toHaveLength(1);
    expect(out.expired).toHaveLength(0);
  });

  it("碰线了才失效，并记下失效时刻", () => {
    const c = card({ key: "k1", symbol: "OP-USDT" });
    const out = advanceCards({
      previous: [c],
      bars: new Map([["OP-USDT", broken]]),
      rows: noRows,
      now: T,
    });
    expect(out.live).toHaveLength(0);
    expect(out.expired[0].expired).toBe(true);
    expect(out.expired[0].expiredAt).toBe(new Date(T).toISOString());
    expect(out.expired[0].expiredBy).toBe("invalidation");
  });

  it("这个币这一轮没被复核、又还没到期 → 继续活着，不当成结束", () => {
    // 判不了不等于死了。漏掉的这部分由前端实时价兜底。
    const c = card({ key: "k1", symbol: "OP-USDT" });
    const out = advanceCards({ previous: [c], bars: new Map(), rows: noRows, now: T });
    expect(out.live).toHaveLength(1);
  });

  it("K 线拿到了但是空的，也算复核不了", () => {
    const c = card({ key: "k1", symbol: "OP-USDT" });
    const out = advanceCards({
      previous: [c],
      bars: new Map([["OP-USDT", []]]),
      rows: noRows,
      now: T,
    });
    expect(out.live).toHaveLength(1);
  });

  it("出现满 6 小时就超时失效，哪怕价格离失效线还很远", () => {
    const old = card({
      key: "k1",
      symbol: "OP-USDT",
      firstSeenAt: new Date(T - 6 * HOUR).toISOString(),
    });
    const out = advanceCards({
      previous: [old],
      bars: new Map([["OP-USDT", safe]]),
      rows: noRows,
      now: T,
    });
    expect(out.live).toHaveLength(0);
    expect(out.expired[0].expiredBy).toBe("timeout");
  });

  it("差一分钟到 6 小时的还活着", () => {
    const almost = card({
      key: "k1",
      symbol: "OP-USDT",
      firstSeenAt: new Date(T - 6 * HOUR + 60_000).toISOString(),
    });
    const out = advanceCards({
      previous: [almost],
      bars: new Map([["OP-USDT", safe]]),
      rows: noRows,
      now: T,
    });
    expect(out.live).toHaveLength(1);
  });

  it("超时不需要 K 线——这轮没被复核的币照样会超时", () => {
    // 否则「拿不到数据的卡继续活着」就成了一条永不过期的后门。
    const old = card({
      key: "k1",
      symbol: "OP-USDT",
      firstSeenAt: new Date(T - 7 * HOUR).toISOString(),
    });
    const out = advanceCards({ previous: [old], bars: new Map(), rows: noRows, now: T });
    expect(out.live).toHaveLength(0);
    expect(out.expired).toHaveLength(1);
  });

  it("超时记的是真正到期那一刻，不是我们发现它的那一刻", () => {
    // 扫描 15 分钟一轮，用 now 会让宽限期平白多出最多一刻钟。
    const bornAt = T - 6 * HOUR - 10 * 60_000;
    const old = card({ key: "k1", symbol: "OP-USDT", firstSeenAt: new Date(bornAt).toISOString() });
    const out = advanceCards({ previous: [old], bars: new Map(), rows: noRows, now: T });
    expect(out.expired[0].expiredAt).toBe(new Date(bornAt + 6 * HOUR).toISOString());
  });

  it("碰线优先于超时——两者都成立时记碰线", () => {
    // 排序上超时在前，所以这条用一张「刚好没到 6 小时、但已经碰线」的卡来验
    // 另一半：没到期的卡走碰线那条路，死因记的是 invalidation。
    const c = card({
      key: "k1",
      symbol: "OP-USDT",
      firstSeenAt: new Date(T - 5 * HOUR).toISOString(),
    });
    const out = advanceCards({
      previous: [c],
      bars: new Map([["OP-USDT", broken]]),
      rows: noRows,
      now: T,
    });
    expect(out.expired[0].expiredBy).toBe("invalidation");
  });

  it("活卡跟着本轮的行刷新分数与因子，身份那几样一动不动", () => {
    const c = card({ key: "k1", symbol: "TIA-USDT", total: 10, factors: { oi: 1, cvd: 1 } });
    const fresh = row({ symbol: "TIA-USDT", total: 88, factors: { oi: 50, cvd: 38 }, price: 120 });
    const out = advanceCards({
      previous: [c],
      bars: new Map([["TIA-USDT", safe]]),
      rows: new Map([["TIA-USDT", fresh]]),
      now: T,
    });
    const got = out.live[0];
    expect(got.total).toBe(88);
    expect(got.factors).toEqual({ oi: 50, cvd: 38 });
    expect(got.key).toBe("k1");
    expect(got.firstSeenAt).toBe(c.firstSeenAt);
    expect(got.firstPrice).toBe(c.firstPrice);
    expect(got.invalidation).toEqual(c.invalidation);
  });

  it("灰卡的宽限期从失效那一刻算，不是从卡片出现算", () => {
    // 一张活了三天才碰线的卡，如果拿 firstSeenAt 量，会在失效的同一秒消失。
    const justDied = card({
      key: "k1",
      symbol: "AAA-USDT",
      firstSeenAt: new Date(T - 3 * 24 * HOUR).toISOString(),
      expired: true,
      expiredAt: new Date(T - 60_000).toISOString(),
    });
    const out = advanceCards({ previous: [justDied], bars: new Map(), rows: noRows, now: T });
    expect(out.expired).toHaveLength(1);
  });

  it("灰卡超过宽限期就丢掉", () => {
    const old = card({
      key: "k1",
      symbol: "AAA-USDT",
      expired: true,
      expiredAt: new Date(T - 3 * HOUR).toISOString(),
    });
    const out = advanceCards({ previous: [old], bars: new Map(), rows: noRows, now: T });
    expect(out.expired).toHaveLength(0);
  });

  it("灰卡不会因为价格又回到线内而复活", () => {
    const dead = card({
      key: "k1",
      symbol: "OP-USDT",
      expired: true,
      expiredAt: new Date(T - 60_000).toISOString(),
    });
    const out = advanceCards({
      previous: [dead],
      bars: new Map([["OP-USDT", safe]]),
      rows: noRows,
      now: T,
    });
    expect(out.live).toHaveLength(0);
    expect(out.expired).toHaveLength(1);
  });

  it("灰卡多于上限时留最近死的那几张", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      card({
        key: `k${i}`,
        symbol: `C${i}-USDT`,
        expired: true,
        // i 越大死得越晚
        expiredAt: new Date(T - (20 - i) * 60_000).toISOString(),
      })
    );
    const out = advanceCards({ previous: many, bars: new Map(), rows: noRows, now: T });
    expect(out.expired).toHaveLength(12);
    expect(out.expired[0].key).toBe("k19");
  });

  it("不改原对象——上一轮的 payload 是从缓存读来的，就地改会污染它", () => {
    const c = card({ key: "k1", symbol: "OP-USDT" });
    advanceCards({ previous: [c], bars: new Map([["OP-USDT", broken]]), rows: noRows, now: T });
    expect(c.expired).toBe(false);
    expect(c.expiredAt).toBeUndefined();
  });

  it("点火卡按收盘判：影线穿过不算，收盘穿过才算", () => {
    const mk = (time: number, high: number, low: number, close: number): CoinGlassPriceBar => ({
      time,
      open: String(close),
      high: String(high),
      low: String(low),
      close: String(close),
      volume_usd: "1",
    });
    const c = card({
      key: "k1",
      symbol: "OP-USDT",
      trigger: { type: "ignition", ignition: ignition({ ignitedAt: T - 2 * HOUR, invalidationPrice: 98 }) },
      invalidation: { price: 98, breach: "below" },
    });
    const wick = [mk(T - HOUR, 105, 96, 101)];
    expect(advanceCards({ previous: [c], bars: new Map([["OP-USDT", wick]]), rows: noRows, now: T }).live).toHaveLength(1);
    const closed = [mk(T - HOUR, 105, 96, 97)];
    expect(advanceCards({ previous: [c], bars: new Map([["OP-USDT", closed]]), rows: noRows, now: T }).expired).toHaveLength(1);
  });
});

describe("refreshCard", () => {
  const T = 1_700_000_000_000;
  const base: AlertCardData = {
    key: "k",
    symbol: "TIA-USDT",
    coin: "TIA",
    trigger: { type: "scenario", scenario: scenario() },
    direction: "long",
    factors: { oi: 1, cvd: 1 },
    total: 5,
    firstSeenAt: new Date(T - 3_600_000).toISOString(),
    firstPrice: 100,
    peakPct: 4,
    invalidation: { price: 90, breach: "below" },
    expired: false,
  };

  it("峰值只增不减——一段回撤不该把最好成绩抹掉", () => {
    const flat = bars([[T - 1_800_000, 101, 99]]);
    const got = refreshCard(base, row({ symbol: "TIA-USDT", price: 100 }), flat);
    expect(got.peakPct).toBe(4);
  });

  it("创了新高就把峰值抬上去", () => {
    const up = bars([[T - 1_800_000, 110, 99]]);
    const got = refreshCard(base, row({ symbol: "TIA-USDT", price: 108 }), up);
    expect(got.peakPct).toBeCloseTo(10, 6);
  });

  it("做空看的是最低价", () => {
    const short = { ...base, direction: "short" as const, peakPct: 0 };
    const down = bars([[T - 1_800_000, 101, 90]]);
    const got = refreshCard(short, row({ symbol: "TIA-USDT", price: 95 }), down);
    expect(got.peakPct).toBeCloseTo(10, 6);
  });
});

describe("triggerInvalidated", () => {
  const T = 1_700_000_000_000;

  it("场景看 K 线极值，插针也算数", () => {
    const t = { type: "scenario" as const, scenario: scenario({ triggeredAt: 0, invalidation: { price: 100, breach: "below" as const } }) };
    expect(triggerInvalidated(t, bars([[T, 110, 99]]))).toBe(true);
  });

  it("恰好碰到失效价不算穿", () => {
    const t = { type: "scenario" as const, scenario: scenario({ triggeredAt: 0, invalidation: { price: 100, breach: "below" as const } }) };
    expect(triggerInvalidated(t, bars([[T, 110, 100]]))).toBe(false);
  });
});
