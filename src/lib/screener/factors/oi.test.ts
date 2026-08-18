import { describe, it, expect } from "vitest";
import {
  oiScore,
  quadrantScore,
  priceChangeOverBars,
  OI_DEADZONE_PCT,
  PRICE_DEADZONE_PCT,
  OI_DIVERGENCE_MAX_ADJUST,
} from "./oi";
import { FACTOR_MAX } from "@/lib/screener/types";
import { findPivots, PIVOT_N } from "./oi-divergence";
import type { CoinGlassOiBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

/** 造一段 30m K 线，收盘价按给定序列走 */
function barsFromCloses(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c * 1.001),
    low: String(c * 0.999),
    close: String(c),
    volume_usd: "1000",
  }));
}

/**
 * 造一段 OI 收盘价序列，使得 priceChangeOverBars 在 barsBack=1/2/8（对应 30m/1h/4h）
 * 时分别算出给定的百分比。长度固定 9 根（`bars.length > 8` 是 barsBack=8 能算出
 * 结果的最短长度）——刻意比下面 oiScore 测试用的 `rising` 价格序列（20 根）短，
 * 这样两条序列长度不等，oiDivergence 会直接返回 0（见 oi-divergence.ts 的长度
 * 校验），背离修正项不会干扰这组只测象限算法的用例。背离本身有专门的
 * oi-divergence.test.ts。
 */
function oiBarsFromWindowPcts(p30m: number, p1h: number, p4h: number): CoinGlassOiBar[] {
  const now = 100;
  const closes = new Array(9).fill(now);
  closes[7] = now / (1 + p30m / 100); // 1 根之前 = 30m
  closes[6] = now / (1 + p1h / 100); // 2 根之前 = 1h
  closes[0] = now / (1 + p4h / 100); // 8 根之前 = 4h
  closes[8] = now;
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
  }));
}

describe("priceChangeOverBars", () => {
  it("按「多少根之前」算涨跌百分比", () => {
    // 100 → 110，两根之前
    expect(priceChangeOverBars(barsFromCloses([100, 105, 110]), 2)).toBeCloseTo(10);
  });

  it("K 线不够长时返回 null，而不是拿最早那根凑数", () => {
    expect(priceChangeOverBars(barsFromCloses([100, 110]), 8)).toBeNull();
  });
});

describe("quadrantScore", () => {
  it("OI 涨 + 价涨 = 新多头进场，做多满分、做空 0", () => {
    expect(quadrantScore(5, 5, "long")).toBe(100);
    expect(quadrantScore(5, 5, "short")).toBe(0);
  });

  it("OI 涨 + 价跌 = 新空头进场，做空满分、做多 0", () => {
    expect(quadrantScore(5, -5, "short")).toBe(100);
    expect(quadrantScore(5, -5, "long")).toBe(0);
  });

  it("OI 跌 + 价涨 = 空头回补，两边都只给中低分", () => {
    expect(quadrantScore(-5, 5, "long")).toBe(40);
    expect(quadrantScore(-5, 5, "short")).toBe(30);
  });

  it("OI 跌 + 价跌 = 多头离场，两边都只给中低分", () => {
    expect(quadrantScore(-5, -5, "long")).toBe(30);
    expect(quadrantScore(-5, -5, "short")).toBe(40);
  });

  it("OI 变化落在死区内给中性 50——微小变化的正负号是噪音不是象限", () => {
    expect(quadrantScore(OI_DEADZONE_PCT / 2, 5, "long")).toBe(50);
  });

  it("价格变化落在死区内同样给中性 50", () => {
    expect(quadrantScore(5, PRICE_DEADZONE_PCT / 2, "long")).toBe(50);
  });

  it("OI 变化越小越向 50 收缩", () => {
    const weak = quadrantScore(0.6, 5, "long");
    const strong = quadrantScore(5, 5, "long");
    expect(weak).toBeLessThan(strong);
    expect(weak).toBeGreaterThan(50);
  });
});

describe("oiScore", () => {
  const rising = barsFromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));

  it("拿不到 OI 序列（空数组）给中性 15", () => {
    expect(oiScore([], rising, "long")).toBe(15);
  });

  it("三个窗口 OI 齐涨 + 价格齐涨 → 做多接近满分", () => {
    expect(oiScore(oiBarsFromWindowPcts(5, 5, 5), rising, "long")).toBeGreaterThan(27);
  });

  it("同样的数据对做空接近 0", () => {
    expect(oiScore(oiBarsFromWindowPcts(5, 5, 5), rising, "short")).toBeLessThan(3);
  });

  it("短窗口权重高于长窗口——15 分钟扫描要抓的是刚发生的资金动作", () => {
    const shortWindowBull = oiScore(oiBarsFromWindowPcts(5, 0, 0), rising, "long");
    const longWindowBull = oiScore(oiBarsFromWindowPcts(0, 0, 5), rising, "long");
    expect(shortWindowBull).toBeGreaterThan(longWindowBull);
  });

  it("分数恒在 [0, 30]", () => {
    for (const bars of [
      oiBarsFromWindowPcts(50, 50, 50),
      oiBarsFromWindowPcts(-50, -50, -50),
      oiBarsFromWindowPcts(0, 0, 0),
    ]) {
      for (const dir of ["long", "short"] as const) {
        const v = oiScore(bars, rising, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(30);
      }
    }
  });
});

/**
 * 「象限 + 背离修正」这条接线的集成测试（T20 review F2）。
 *
 * 上面 oiScore 那组用例全部让 oiBars 与 rising（priceBars）长度不等，
 * oiDivergence 因为长度校验直接返回 0——这个隔离本身是对的（能单独测
 * 象限算法），但代价是 oi.ts 里「signed → 按方向翻号 → clamp」那几行
 * 从没被断言过。这里补一组等长序列的用例，专门测这条接线。
 *
 * 造夹具的关键技巧：priceBars 的 close 字段只喂 quadrant（象限），
 * high/low 字段只喂 oiDivergence 的摆动点识别——两者是完全独立的字段，
 * 可以分别控制，互不干扰。同理 oiBars 的 close 在「摆动点下标」（5、17）
 * 与「quadrant 窗口下标」（21、27、28、29，即 barsBack=8/2/1 相对末尾
 * 读到的下标）上也是各自独立的两组下标，可以分别设定数值。
 */
describe("象限 + 背离修正的集成", () => {
  const ANCHOR_PREV = 5;
  const ANCHOR_CURR = 17;
  const LEN = 30;

  /** 两谷结构（谷 1 在 index 5，谷 2 在 index 17，谷 2 比谷 1 低 5%），
   *  18-29 用单调递增的尾巴收尾——不能用一长段常数，常数尾巴长度一旦
   *  超过窗口宽度，会在尾巴内部自己长出新的「平坦摆动点」，把我们想要的
   *  (5,17) 挤出「最后两个已确认摆动点」，这是本轮 review 之前踩过的坑。
   */
  function twoTroughLowsWithTail(): number[] {
    const values = [
      110, 108, 106, 104, 102, // 0-4，爬向谷 1
      100, // 5，谷 1
      102, 104, 106, 108, 110, // 6-10，镜像回升
      110, // 11，过渡
      105, 103, 101, 99, 97, // 12-16，爬向谷 2
      95, // 17，谷 2（比谷 1 低 5%，过 PRICE_EXTREME_MIN_PCT）
    ];
    // 目标长度必须在循环开始前算好、存成常量——写成 `i < LEN - values.length`
    // 是活生生的教训：values.length 在循环体里每 push 一次就变一次，循环
    // 条件跟着水涨船高，实际只推进了一半就提前停了（18 根变成 24 根，
    // 不是想要的 30 根），第一次交上去的版本这里错了，靠 F2 新增的自检
    // 断言（下面 findPivots 那条）当场抓出来。
    const tailLen = LEN - values.length;
    for (let i = 0; i < tailLen; i++) values.push(96 + i); // 18-29，单调递增尾巴
    return values;
  }

  /** 两峰结构（峰 1 在 index 5，峰 2 在 index 17，峰 2 比峰 1 高 5%），
   *  18-29 用单调递减的尾巴——原理同上，避免尾巴自己长出新摆动点。 */
  function twoPeakHighsWithTail(): number[] {
    const values = [
      90, 92, 94, 96, 98, // 0-4，爬向峰 1
      100, // 5，峰 1
      98, 96, 94, 92, 90, // 6-10，镜像下坡
      80, // 11，过渡
      94.5, 97.65, 99.75, 101.85, 103.95, // 12-16，爬向峰 2
      105, // 17，峰 2（比峰 1 高 5%）
    ];
    const tailLen = LEN - values.length; // 同上，先定长度再循环，不要在循环条件里重算
    for (let i = 0; i < tailLen; i++) values.push(104 - i); // 18-29，单调递减尾巴
    return values;
  }

  function flatArray(v: number): number[] {
    return new Array(LEN).fill(v);
  }

  /** 造一段长度 LEN 的数值序列：默认值 defaultVal，指定下标用 overrides 覆盖。 */
  function withOverrides(defaultVal: number, overrides: Record<number, number>): number[] {
    const arr = new Array(LEN).fill(defaultVal);
    for (const [idx, v] of Object.entries(overrides)) arr[Number(idx)] = v;
    return arr;
  }

  function priceBarsWithFields(highs: number[], lows: number[], closes: number[]): CoinGlassPriceBar[] {
    return closes.map((c, i) => ({
      time: i * 1_800_000,
      open: String(c),
      high: String(highs[i]),
      low: String(lows[i]),
      close: String(c),
      volume_usd: "1000",
    }));
  }

  function oiBarsWithOverrides(overrides: Record<number, number>): CoinGlassOiBar[] {
    return Array.from({ length: LEN }, (_, i) => {
      const c = overrides[i] ?? 100;
      // open/low 字符串、high/close 数字，贴合 T20 review F1 实测的混合类型响应。
      return { time: i * 1_800_000, open: String(c), high: c, low: String(c), close: c };
    });
  }

  it("背离按方向翻号：同一份输入下，偏多的背离让 long 分高于 short 分", () => {
    // priceBars 的 close 全程持平（0% 变化，落在 PRICE_DEADZONE_PCT 内）——
    // 象限对 long/short 都直接返回中性 50，不受 OI 影响，这样 long 与
    // short 的分数差就只由背离修正贡献，干净可算。
    const lows = twoTroughLowsWithTail();
    const highs = flatArray(500);
    const closes = flatArray(100);
    const priceBars = priceBarsWithFields(highs, lows, closes);

    // 自检：确认摆动点真的落在 (5,17)，不是又数错了地方
    // （这个坑本轮已经踩过一次：早期草稿把峰值搭到了 index 16）。
    expect(findPivots(lows, PIVOT_N, "low")).toEqual([ANCHOR_PREV, ANCHOR_CURR]);

    // OI 在 (5,17) 上 -20%（trough2 处 OI 更低）→ 底背离，偏多，signed=+1。
    const oiBars = oiBarsWithOverrides({ [ANCHOR_PREV]: 100, [ANCHOR_CURR]: 80 });

    const long = oiScore(oiBars, priceBars, "long");
    const short = oiScore(oiBars, priceBars, "short");

    // base=50（象限中性）在因子分上是 15；背离取满（signed=+1）时修正量
    // 恰好是上限 OI_DIVERGENCE_MAX_ADJUST（20，映射到因子分是 6）——
    // long 应该被推到 15+6=21，short 被推到 15-6=9，不多不少。
    const baseFactor = (50 / 100) * FACTOR_MAX.oi;
    const capFactor = (OI_DIVERGENCE_MAX_ADJUST / 100) * FACTOR_MAX.oi;
    expect(baseFactor).toBe(15);
    expect(capFactor).toBe(6);

    expect(long).toBeCloseTo(baseFactor + capFactor); // 21
    expect(short).toBeCloseTo(baseFactor - capFactor); // 9
    expect(long).toBeGreaterThan(short);

    // 修正量确实被 OI_DIVERGENCE_MAX_ADJUST 封顶：这里背离已经取满（±1），
    // 相对基础分的偏移不应该超过上限本身。
    expect(Math.abs(long - baseFactor)).toBeLessThanOrEqual(capFactor + 1e-9);
    expect(Math.abs(short - baseFactor)).toBeLessThanOrEqual(capFactor + 1e-9);
  });

  it("clamp 的两端真的被触发到——背离把一个没顶格的象限基础分推出界，不是象限自己顶格", () => {
    // 关键设计点：quadrant 基础分不能直接用满强度（strength=1）顶到 0/100——
    // 那样即便背离的符号翻转搞错了（signed 恒为 0），0+0*20 与 100+0*20
    // 仍然分别是 0 与 100，这条用例会「测什么都无所谓地通过」，测不出接线
    // 是否真的接对。所以这里刻意把 quadrant 的 OI 变化定在 1.6%（介于
    // OI_DEADZONE_PCT=0.5% 与 OI_FULL_STRENGTH_PCT=2% 之间），让
    // strength=0.8、base(long)=10、base(short)=90——都没有顶格。
    // 只有背离真的按方向翻号、真的贡献了 ±20，才会把 10 推到 -10、
    // 90 推到 110，进而触发 clamp 落在 0 与 30（FACTOR_MAX.oi）；如果背离
    // 接线断了（signed 恒为 0），这条用例会得到 3 与 27，而不是 0 与 30，
    // 断言会失败——这才是这条用例真正在验证的东西。
    const highs = twoPeakHighsWithTail();
    const lows = flatArray(10);
    // quadrant 尾部四个下标（21/27/28/29，即 barsBack=8/2/1 相对末尾 29 读到的
    // 下标）：close 下跌（200→100，远超 PRICE_DEADZONE_PCT，量级不影响
    // strength，strength 只看 OI 那侧的变化幅度）。
    const closes = withOverrides(500, { 21: 200, 27: 200, 28: 200, 29: 100 });
    const priceBars = priceBarsWithFields(highs, lows, closes);

    // 自检：确认摆动点真的落在 (5,17)。
    expect(findPivots(highs, PIVOT_N, "high")).toEqual([ANCHOR_PREV, ANCHOR_CURR]);

    // OI 在 (5,17) 上 -20% → 顶背离，偏空，signed=-1；
    // OI 在 quadrant 尾部四个下标上从 100 涨到 101.6（+1.6%），给三个窗口
    // 都提供 strength=0.8 的「OI 涨」信号——不多不少，刚好落在死区和满强度
    // 之间，见上面的设计说明。
    const oiBars = oiBarsWithOverrides({
      [ANCHOR_PREV]: 100,
      [ANCHOR_CURR]: 80,
      21: 100,
      27: 100,
      28: 100,
      29: 101.6,
    });

    // long 方向：base=10，背离偏空（directional=signed=-1）继续往下推 20，
    // 10 + (-1)*20 = -10，不 clamp 的话会跌破 [0,30] 的下界。
    const long = oiScore(oiBars, priceBars, "long");
    expect(long).toBe(0);

    // short 方向：base=90，背离对 short 翻号后是偏多（directional=-signed=+1），
    // 继续往上推 20，90 + 1*20 = 110，不 clamp 的话会超出 [0,100] 的上界。
    const short = oiScore(oiBars, priceBars, "short");
    expect(short).toBe(FACTOR_MAX.oi);
  });
});
