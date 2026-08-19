import { describe, it, expect } from "vitest";
import { pickDirection, scoreDirection, amplitudeFromBars, type ScoreInputs } from "./score";
import { FACTOR_MAX } from "./types";
import type { CoinGlassPriceBar, CoinGlassTakerBar, CoinGlassOiBar } from "@/lib/coinglass/types";

function priceBars(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c * 1.01),
    low: String(c * 0.99),
    close: String(c),
    volume_usd: "10000",
  }));
}

function taker(delta: number, n = 48): CoinGlassTakerBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 1_800_000,
    aggregated_buy_volume_usd: (1000 + delta) / 2,
    aggregated_sell_volume_usd: (1000 - delta) / 2,
  }));
}

/**
 * 造一段 OI 收盘价序列，使 priceChangeOverBars 在 barsBack=1/2/8（30m/1h/4h）
 * 分别算出给定百分比——用法与 oi.test.ts 里的 oiBarsFromWindowPcts 相同。
 * 长度固定 9 根，刻意比下面 bullish.priceBars（60 根）短：两条序列长度不等时
 * oiDivergence 直接返回 0（见 oi-divergence.ts 的长度校验），这样这个文件里
 * 测装配逻辑（方向判定、取整、总分范围）的用例不会被背离修正项干扰——
 * 背离本身有专门的 oi-divergence.test.ts。
 */
function oiBars(p30m: number, p1h: number, p4h: number): CoinGlassOiBar[] {
  const now = 100;
  const closes = new Array(9).fill(now);
  closes[7] = now / (1 + p30m / 100);
  closes[6] = now / (1 + p1h / 100);
  closes[0] = now / (1 + p4h / 100);
  closes[8] = now;
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
  }));
}

const bullish: ScoreInputs = {
  price: 100,
  priceBars: priceBars(Array.from({ length: 60 }, (_, i) => 90 + i * 0.2)),
  taker: taker(600),
  oiBars: oiBars(5, 5, 5),
};

describe("scoreDirection", () => {
  it("两项都落在各自的上限内", () => {
    const f = scoreDirection(bullish, "long");
    expect(f.oi).toBeLessThanOrEqual(FACTOR_MAX.oi);
    expect(f.cvd).toBeLessThanOrEqual(FACTOR_MAX.cvd);
  });
});

describe("pickDirection", () => {
  it("明显偏多的输入应判定为 long", () => {
    // bullish 的构造是价格单调上行 + OI 三窗口齐涨 + 主动买压持续为正，
    // 方向应当稳定为 long。不在测试里重算 longTotal/shortTotal 去比较——
    // 那等于把被测公式在断言里重新实现一遍，生产代码和测试同时写错时
    // 发现不了。
    const picked = pickDirection(bullish);
    expect(picked.direction).toBe("long");
  });

  it("total 恒等于取整后两项之和——扫过真的会让两条取整路径分叉的输入", () => {
    // 原来这里是三维网格（price t × taker delta × oiPct），因为 t 会驱动
    // Zone 因子。Zone 退役之后 scoreDirection 不再消费 inputs.price——
    // oiScore/cvdScore 只吃 oiBars/priceBars/taker，price 这个字段对两个
    // 剩下的因子完全是死参数。继续在网格里扫 t 只会让每一轮都算出同一组
    // 结果，白白跑 11 倍的重复用例，所以改成只保留 delta × oiPct 这两维，
    // 但把取值密度提高，确保网格依然扫得到能让两条取整路径分叉的输入
    // （用 2026-08-19 的实现验算过：这组网格里有 25/925 个组合会分叉，
    // 不是靠运气蒙到一个）。
    let sawDivergence = false;

    const deltas: number[] = [];
    for (let d = -900; d <= 900; d += 50) deltas.push(d);
    const oiPcts: number[] = [];
    for (let p = -6; p <= 6; p += 0.5) oiPcts.push(p);

    for (const delta of deltas) {
      for (const oiPct of oiPcts) {
        const inputs: ScoreInputs = {
          ...bullish,
          taker: taker(delta),
          oiBars: oiBars(oiPct, oiPct, oiPct),
        };
        const picked = pickDirection(inputs);
        const raw = scoreDirection(inputs, picked.direction);
        const rawSum = raw.oi + raw.cvd;
        const sumOfRounded = picked.factors.oi + picked.factors.cvd;

        // 这一组输入能不能区分「先求和再取整」与「先取整再求和」
        if (Math.round(rawSum) !== sumOfRounded) sawDivergence = true;

        expect(picked.total).toBe(sumOfRounded);
      }
    }

    // 没有任何一组输入让两条取整路径分叉的话，上面那条断言对 bug 版本也成立，
    // 这个用例就退化成空断言。这一条把「用例失效」本身变成一次测试失败。
    expect(sawDivergence).toBe(true);
  });

  it("总分恒在 [0, 100]，且是整数", () => {
    const p = pickDirection(bullish);
    expect(p.total).toBeGreaterThanOrEqual(0);
    expect(p.total).toBeLessThanOrEqual(100);
    expect(Number.isInteger(p.total)).toBe(true);
  });

  it("输入全空时不抛错，返回一个可用的中性结果", () => {
    const empty: ScoreInputs = {
      price: 1,
      priceBars: [],
      taker: [],
      oiBars: [],
    };
    const p = pickDirection(empty);
    expect(p.total).toBeGreaterThanOrEqual(0);
    expect(p.total).toBeLessThan(100);
  });
});

describe("amplitudeFromBars", () => {
  it("按近 48 根的最高最低算振幅", () => {
    // low = 99, high = 101.01 → 约 2.03%
    expect(amplitudeFromBars(priceBars([100, 100]))!).toBeGreaterThan(1.9);
  });

  it("K 线为空返回 null", () => {
    expect(amplitudeFromBars([])).toBeNull();
  });
});
