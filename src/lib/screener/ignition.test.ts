import { describe, it, expect } from "vitest";
import { detectIgnition, IGNITION_LOOKBACK_BARS, IGNITION_MAX_AGE_BARS } from "./ignition";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

/** [high, low, close] → K 线 */
function bars(specs: Array<[number, number, number]>): CoinGlassPriceBar[] {
  return specs.map(([high, low, close], i) => ({
    time: i * 1_800_000,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(close),
    volume_usd: "1",
  }));
}

/** N 根在 [100,110] 区间内震荡的 K 线，再接一根由调用方指定的 */
function withHistory(last: [number, number, number], n = IGNITION_LOOKBACK_BARS) {
  return bars([...Array.from({ length: n }, () => [110, 100, 105] as [number, number, number]), last]);
}

describe("detectIgnition", () => {
  it("收盘越过前 6 小时高点 = 向上点火，点火线是那个高点，失效线在它下方 1×ATR", () => {
    // 历史 12 根都是 [110, 100]，真实波幅恒为 10，ATR = 10（相对 level 110
    // 是 9.09%），所以失效线 = 110 − 10 = 100。
    expect(detectIgnition(withHistory([115, 108, 112]))).toEqual({
      direction: "up",
      level: 110,
      invalidationPrice: expect.closeTo(100, 6),
      distancePct: expect.closeTo(1.818, 2),
      ignitedAt: IGNITION_LOOKBACK_BARS * 1_800_000,
      barsAgo: 0,
    });
  });

  it("失效线在区间边界之外，不在边界上", () => {
    // 这条单独钉一下方向：向上点火的失效线必须**低于**被突破的高点，
    // 向下点火的必须**高于**被跌破的低点。写反了会让每张卡一出生就失效。
    const up = detectIgnition(withHistory([115, 108, 112]))!;
    expect(up.invalidationPrice).toBeLessThan(up.level);
    const down = detectIgnition(withHistory([102, 95, 98]))!;
    expect(down.invalidationPrice).toBeGreaterThan(down.level);
  });

  it("价格收回区间内、但还没碰到失效线 = 点火仍然成立", () => {
    // 这是加缓冲的全部意义。实测 773 个事件，失效线画在区间边界上时 84%
    // 会被打穿，而且中位情况下在行情走出任何东西之前就作废了（吃到的
    // MFE 中位 0.00%），其中 37% 后来仍然走到 ≥2%——全是白丢的。
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as [number, number, number]),
      [115, 108, 112],
      [113, 104, 105], // 收回 110 之下，但仍在失效线 100 之上
    ]);
    const r = detectIgnition(b);
    expect(r).not.toBeNull();
    expect(r!.level).toBe(110);
  });

  it("收盘跌破前 6 小时低点 = 向下点火", () => {
    const r = detectIgnition(withHistory([102, 95, 98]))!;
    expect(r.direction).toBe("down");
    expect(r.level).toBe(100);
  });

  it("还在区间里 = 没点火", () => {
    expect(detectIgnition(withHistory([109, 101, 105]))).toBeNull();
  });

  it("影线穿了但收回来 = 不算点火", () => {
    // 这是最典型的假突破：最高价 120 远超前高 110，但收盘 105 还在区间里。
    // 点火刻意用收盘价而不是最高价，就是为了挡掉它——跟失效判定用区间
    // 极值（插针也算数）是相反的口径，因为两者要防的错误相反：
    // 失效怕漏判，点火怕误判。
    expect(detectIgnition(withHistory([120, 101, 105]))).toBeNull();
  });

  it("恰好等于边界不算突破", () => {
    expect(detectIgnition(withHistory([112, 105, 110]))).toBeNull();
  });

  it("比较区间不含当前这根——否则永远突破不了", () => {
    // 当前根自己的 high=115 是区间内最高，如果把它算进比较区间，
    // close=112 就永远不可能 > high，点火恒为 null。
    expect(detectIgnition(withHistory([115, 108, 112]))).not.toBeNull();
  });

  it("K 线不够回看窗口时返回 null", () => {
    expect(detectIgnition(withHistory([115, 108, 112], 5))).toBeNull();
  });

  // ↓ 以下是「点火要能撑住一段时间」这件事的用例。
  // 早先 detectIgnition 只看最后一根，检测本身没错，但拿来做卡片就不行了：
  // 突破只在那一根上成立，下一轮扫描就判不出来，卡片会闪一下就消失。
  // 实测后果是主扫描表的点火列 20 行全空——「恰好这一根在突破」是小概率瞬间。

  it("突破之后横盘，只要守住那条线，点火仍然成立且锚点不变", () => {
    // 第 13 根突破（收 112 > 前高 110），之后两根在 111–113 之间横着，
    // 都没有再创新高，但都还在 110 之上。
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as [number, number, number]),
      [115, 108, 112],
      [114, 111, 111.5],
      [113, 110.5, 111],
    ]);
    const r = detectIgnition(b)!;
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
      return [h, h - 1, h - 0.5] as [number, number, number];
    });
    const level = 100 + 11 * 0.9; // 109.9 = 历史区间顶
    const b = bars([
      ...hist,
      [level + 2, level, level + 1], // 收 110.9 > 109.9 → 向上点火，ATR≈1.4，失效线≈108.5
      [level - 1, level - 3, level - 2.5], // 收 107.4，跌破失效线；离区间底 99 还远，不构成向下点火
    ]);
    expect(detectIgnition(b)).toBeNull();
  });

  it("连续突破时锚在这一串的第一根——否则钥匙每根一换，卡片计时永远重置", () => {
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as [number, number, number]),
      [115, 108, 112],
      [120, 113, 118],
      [126, 119, 124],
    ]);
    const r = detectIgnition(b)!;
    expect(r.ignitedAt).toBe(12 * 1_800_000);
    expect(r.barsAgo).toBe(2);
    expect(r.level).toBe(110); // 第一根突破时的那条线，不是最后一根的
  });

  it("点火超过 maxAge 根就不再认——过期的信号不该继续挂在警报栏", () => {
    const tail: Array<[number, number, number]> = Array.from(
      { length: IGNITION_MAX_AGE_BARS + 2 },
      () => [113, 111, 112]
    );
    const b = bars([
      ...Array.from({ length: 12 }, () => [110, 100, 105] as [number, number, number]),
      [115, 108, 112],
      ...tail,
    ]);
    expect(detectIgnition(b)).toBeNull();
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
    const flat: Array<[number, number, number]> = Array.from({ length: 12 }, () => [110, 100, 105]);
    const rally = (n: number) => {
      const up: Array<[number, number, number]> = [];
      let p = 112;
      for (let i = 0; i < n; i++) {
        up.push([p + 3, p - 4, p]);
        p += 6;
      }
      return bars([...flat, ...up]);
    };

    // 头一根突破的时刻，此后不管这波走多久都该是同一个值
    const first = detectIgnition(rally(1))!.ignitedAt;
    for (let n = 2; n <= IGNITION_MAX_AGE_BARS + 1; n++) {
      const r = detectIgnition(rally(n));
      expect(r, `连续突破 ${n} 根时不该判空`).not.toBeNull();
      expect(r!.ignitedAt, `连续突破 ${n} 根时 ignitedAt 漂了`).toBe(first);
      expect(r!.barsAgo).toBe(n - 1);
    }
  });

  // 上面那个 bug 的第二重后果：barsAgo 被永远钉在 maxAgeBars 上，
  // 这道 4 小时上限一次都不会生效，过期信号无限期挂在警报栏里
  it("一路创新高超过 maxAge 之后就不再认，而不是重新计时", () => {
    const flat: Array<[number, number, number]> = Array.from({ length: 12 }, () => [110, 100, 105]);
    const up: Array<[number, number, number]> = [];
    let p = 112;
    for (let i = 0; i < IGNITION_MAX_AGE_BARS + 2; i++) {
      up.push([p + 3, p - 4, p]);
      p += 6;
    }
    expect(detectIgnition(bars([...flat, ...up]))).toBeNull();
  });

  it("非法价格不误判成点火", () => {
    const b = withHistory([115, 108, 112]);
    b[b.length - 1] = { ...b[b.length - 1], close: "abc" };
    expect(detectIgnition(b)).toBeNull();
  });
});
