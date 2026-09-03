import { describe, it, expect } from "vitest";
import {
  detectIgnition,
  IGNITION_LOOKBACK_BARS,
  IGNITION_MAX_AGE_BARS,
  IGNITION_VOLUME_RATIO_MIN,
} from "./ignition";
import type { CoinGlassPriceBar, CoinGlassOiBar } from "@/lib/coinglass/types";

type Spec = [high: number, low: number, close: number] | [number, number, number, volume: number];

/** 背景根的成交量。点火那根要给到 BREAKOUT_VOL 才过得了放量门。 */
const BASE_VOL = 1;
const BREAKOUT_VOL = 10;

/** [high, low, close, 成交量?] → K 线。成交量不给就是 BASE_VOL。 */
function bars(specs: Spec[]): CoinGlassPriceBar[] {
  return specs.map(([high, low, close, vol], i) => ({
    time: i * 1_800_000,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(close),
    volume_usd: String(vol ?? BASE_VOL),
  }));
}

/**
 * 一路上升的 OI，长度足够覆盖任意价格序列。
 *
 * 点火要求「那根 K 线 OI 增加」，所以**结构类**的用例必须先把 OI 这道门喂满，
 * 否则测的就不是它想测的东西了（会因为 OI 没涨而返回 null，看起来像结构判断
 * 出错）。OI 这道门本身由它自己的用例覆盖。
 */
function risingOi(n: number): CoinGlassOiBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 1_800_000,
    open: 0,
    high: 0,
    low: 0,
    close: 1000 + i * 10,
  }));
}

/** 平的 OI——用来验「OI 没增加就不算点火」。 */
function flatOi(n: number): CoinGlassOiBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 1_800_000,
    open: 0,
    high: 0,
    low: 0,
    close: 1000,
  }));
}

/** 默认喂满 OI，让结构类用例只测结构 */
function detect(b: CoinGlassPriceBar[], oi: CoinGlassOiBar[] = risingOi(b.length)) {
  return detectIgnition(b, oi);
}

/** N 根在 [100,110] 区间内震荡的 K 线，再接一根由调用方指定的（默认放量） */
function withHistory(last: [number, number, number], n = IGNITION_LOOKBACK_BARS) {
  return bars([
    ...Array.from({ length: n }, () => [110, 100, 105] as Spec),
    [last[0], last[1], last[2], BREAKOUT_VOL] as Spec,
  ]);
}

describe("detectIgnition", () => {
  it("收盘越过前 6 小时高点 = 向上点火，点火线是那个高点，失效线在它下方 1×ATR", () => {
    // 历史 12 根都是 [110, 100]，真实波幅恒为 10，ATR = 10（相对 level 110
    // 是 9.09%），所以失效线 = 110 − 10 = 100。
    expect(detect(withHistory([115, 108, 112]))).toEqual({
      direction: "up",
      level: 110,
      invalidationPrice: expect.closeTo(100, 6),
      distancePct: expect.closeTo(1.818, 2),
      ignitedAt: IGNITION_LOOKBACK_BARS * 1_800_000,
      barsAgo: 0,
      volumeRatio: BREAKOUT_VOL / BASE_VOL,
      oiChangePct: expect.closeTo(0.9, 1),
    });
  });

  it("失效线在区间边界之外，不在边界上", () => {
    // 这条单独钉一下方向：向上点火的失效线必须**低于**被突破的高点，
    // 向下点火的必须**高于**被跌破的低点。写反了会让每张卡一出生就失效。
    const up = detect(withHistory([115, 108, 112]))!;
    expect(up.invalidationPrice).toBeLessThan(up.level);
    const down = detect(withHistory([102, 95, 98]))!;
    expect(down.invalidationPrice).toBeGreaterThan(down.level);
  });

  it("价格收回区间内、但还没碰到失效线 = 点火仍然成立", () => {
    // 这是加缓冲的全部意义。实测 773 个事件，失效线画在区间边界上时 84%
    // 会被打穿，而且中位情况下在行情走出任何东西之前就作废了（吃到的
    // MFE 中位 0.00%），其中 37% 后来仍然走到 ≥2%——全是白丢的。
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as Spec),
      [115, 108, 112, BREAKOUT_VOL] as Spec,
      [113, 104, 105], // 收回 110 之下，但仍在失效线 100 之上
    ]);
    const r = detect(b);
    expect(r).not.toBeNull();
    expect(r!.level).toBe(110);
  });

  it("收盘跌破前 6 小时低点 = 向下点火", () => {
    const r = detect(withHistory([102, 95, 98]))!;
    expect(r.direction).toBe("down");
    expect(r.level).toBe(100);
  });

  it("还在区间里 = 没点火", () => {
    expect(detect(withHistory([109, 101, 105]))).toBeNull();
  });

  it("影线穿了但收回来 = 不算点火", () => {
    // 这是最典型的假突破：最高价 120 远超前高 110，但收盘 105 还在区间里。
    // 点火刻意用收盘价而不是最高价，就是为了挡掉它——跟失效判定用区间
    // 极值（插针也算数）是相反的口径，因为两者要防的错误相反：
    // 失效怕漏判，点火怕误判。
    expect(detect(withHistory([120, 101, 105]))).toBeNull();
  });

  it("恰好等于边界不算突破", () => {
    expect(detect(withHistory([112, 105, 110]))).toBeNull();
  });

  it("比较区间不含当前这根——否则永远突破不了", () => {
    // 当前根自己的 high=115 是区间内最高，如果把它算进比较区间，
    // close=112 就永远不可能 > high，点火恒为 null。
    expect(detect(withHistory([115, 108, 112]))).not.toBeNull();
  });

  it("K 线不够回看窗口时返回 null", () => {
    expect(detect(withHistory([115, 108, 112], 5))).toBeNull();
  });

  // ↓ 以下是「点火要能撑住一段时间」这件事的用例。
  // 早先 detectIgnition 只看最后一根，检测本身没错，但拿来做卡片就不行了：
  // 突破只在那一根上成立，下一轮扫描就判不出来，卡片会闪一下就消失。
  // 实测后果是主扫描表的点火列 20 行全空——「恰好这一根在突破」是小概率瞬间。

  it("突破之后横盘，只要守住那条线，点火仍然成立且锚点不变", () => {
    // 第 13 根突破（收 112 > 前高 110），之后两根在 111–113 之间横着，
    // 都没有再创新高，但都还在 110 之上。
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as Spec),
      [115, 108, 112, BREAKOUT_VOL] as Spec,
      [114, 111, 111.5],
      [113, 110.5, 111],
    ]);
    const r = detect(b)!;
    expect(r.direction).toBe("up");
    expect(r.level).toBe(110);
    // 锚在最初突破那一根（下标 12），不是最后一根
    expect(r.ignitedAt).toBe(12 * 1_800_000);
    expect(r.barsAgo).toBe(2);
  });

  it("跌破失效线 = 点火熄灭", () => {
    // 这里不能用 withHistory 那组「每根都横跨整个区间」的 K 线：它的 ATR
    // 等于区间宽度本身，失效线正好落在区间底上，于是「跌破失效线」和
    // 「向下突破」变成同一件事——函数会判出一次新的向下点火而不是 null，
    // 测的就不是想测的东西了。用一段缓慢上行、单根波幅很小的历史。
    const hist = Array.from({ length: 12 }, (_, i) => {
      const h = 100 + i * 0.9;
      return [h, h - 1, h - 0.5] as Spec;
    });
    const level = 100 + 11 * 0.9; // 109.9 = 历史区间顶
    const b = bars([
      ...hist,
      [level + 2, level, level + 1, BREAKOUT_VOL] as Spec, // 收 110.9 > 109.9 → 向上点火，ATR≈1.4，失效线≈108.5
      [level - 1, level - 3, level - 2.5], // 收 107.4，跌破失效线；离区间底 99 还远，不构成向下点火
    ]);
    expect(detect(b)).toBeNull();
  });

  it("连续突破时锚在这一串的第一根——否则钥匙每根一换，卡片计时永远重置", () => {
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as Spec),
      [115, 108, 112, BREAKOUT_VOL] as Spec,
      [120, 113, 118],
      [126, 119, 124],
    ]);
    const r = detect(b)!;
    expect(r.ignitedAt).toBe(12 * 1_800_000);
    expect(r.barsAgo).toBe(2);
    expect(r.level).toBe(110); // 第一根突破时的那条线，不是最后一根的
  });

  it("点火超过 maxAge 根就不再认——过期的信号不该继续挂在警报栏", () => {
    const tail: Spec[] = Array.from({ length: IGNITION_MAX_AGE_BARS + 2 }, () => [113, 111, 112]);
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as Spec),
      [115, 108, 112, BREAKOUT_VOL] as Spec,
      ...tail,
    ]);
    expect(detect(b)).toBeNull();
  });

  /**
   * 线上重复推送的根因。
   *
   * 往回找 origin 那一步曾经用 oldest(= last - maxAgeBars) 收边，而 oldest 跟着
   * 最后一根一起往前爬，于是一串长过 maxAge 的连续突破里 origin 被顶在 oldest
   * 上、每根新 K 线挪一格——ignitedAt 每 30 分钟换一个值。备忘钥匙就是
   * `symbol|ignition|方向|ignitedAt`，钥匙一变这张卡就是全新的结构事件，
   * Telegram 把同一次点火每半小时重推一遍。
   */
  it("一路创新高时 ignitedAt 不漂移——钥匙不稳就会重复推送", () => {
    const flat: Spec[] = Array.from({ length: 12 }, () => [110, 100, 105]);
    const rally = (n: number) => {
      const up: Spec[] = [];
      let p = 112;
      for (let i = 0; i < n; i++) {
        up.push([p + 3, p - 4, p, BREAKOUT_VOL]);
        p += 6;
      }
      return bars([...flat, ...up]);
    };

    // 头一根突破的时刻，此后不管这波走多久都该是同一个值
    const first = detect(rally(1))!.ignitedAt;
    for (let n = 2; n <= IGNITION_MAX_AGE_BARS + 1; n++) {
      const r = detect(rally(n));
      expect(r, `连续突破 ${n} 根时不该判空`).not.toBeNull();
      expect(r!.ignitedAt, `连续突破 ${n} 根时 ignitedAt 漂了`).toBe(first);
      expect(r!.barsAgo).toBe(n - 1);
    }
  });

  // 上面那个 bug 的第二重后果：barsAgo 被永远钉在 maxAgeBars 上，
  // 这道 4 小时上限一次都不会生效，过期信号无限期挂在警报栏里
  it("一路创新高超过 maxAge 之后就不再认，而不是重新计时", () => {
    const flat: Spec[] = Array.from({ length: 12 }, () => [110, 100, 105]);
    const up: Spec[] = [];
    let p = 112;
    for (let i = 0; i < IGNITION_MAX_AGE_BARS + 2; i++) {
      up.push([p + 3, p - 4, p, BREAKOUT_VOL]);
      p += 6;
    }
    expect(detect(bars([...flat, ...up]))).toBeNull();
  });

  /**
   * 以下两道门是「点火」和「一根没人参与的针」的区别。
   *
   * 盘口薄的时候几十万美元就能把价格推出区间，然后原样掉回来；而价格突破
   * 配上 OI 下降，说明推力来自正在离场的人（空头回补／多头平仓），走完就没了。
   * 这两种情况在 K 线上跟真启动长得一模一样，只有量和 OI 能分开。
   */
  it("点火那根没放量 = 不算点火", () => {
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as Spec),
      [115, 108, 112, BASE_VOL] as Spec, // 跟前面 12 根一样的量，比值 1.0 < 1.5
    ]);
    expect(detect(b)).toBeNull();
  });

  it("放量刚好到线上就算数——门槛是 ≥，不是 >", () => {
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as Spec),
      [115, 108, 112, BASE_VOL * IGNITION_VOLUME_RATIO_MIN] as Spec,
    ]);
    expect(detect(b)).not.toBeNull();
  });

  it("点火那根 OI 没增加 = 不算点火", () => {
    // 结构、放量都满足，只有 OI 是平的。
    const b = withHistory([115, 108, 112]);
    expect(detect(b, flatOi(b.length))).toBeNull();
  });

  it("OI 序列长度对不上时宁可判空，不拿错位的 OI 放行", () => {
    const b = withHistory([115, 108, 112]);
    expect(detect(b, risingOi(3))).toBeNull();
  });

  it("非法价格不误判成点火", () => {
    const b = withHistory([115, 108, 112]);
    b[b.length - 1] = { ...b[b.length - 1], close: "abc" };
    expect(detect(b)).toBeNull();
  });
});
