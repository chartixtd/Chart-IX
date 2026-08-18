import { describe, it, expect } from "vitest";
import { pickDirection, scoreDirection, amplitudeFromBars, type ScoreInputs } from "./score";
import { FACTOR_MAX } from "./types";
import type { CoinGlassPriceBar, CoinGlassTakerBar, CoinGlassLiquidationBar } from "@/lib/coinglass/types";

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
    taker_buy_volume_usd: String((1000 + delta) / 2),
    taker_sell_volume_usd: String((1000 - delta) / 2),
  }));
}

function liq(n = 48): CoinGlassLiquidationBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 1_800_000,
    long_liquidation_usd: "1000",
    short_liquidation_usd: "1000",
  }));
}

const bullish: ScoreInputs = {
  price: 100,
  priceBars: priceBars(Array.from({ length: 60 }, (_, i) => 90 + i * 0.2)),
  liquidation: liq(),
  taker: taker(600),
  openInterest: {
    exchange: "All",
    symbol: "X",
    open_interest_usd: 1_000_000,
    open_interest_change_percent_5m: 0,
    open_interest_change_percent_15m: 0,
    open_interest_change_percent_30m: 5,
    open_interest_change_percent_1h: 5,
    open_interest_change_percent_4h: 5,
    open_interest_change_percent_24h: 5,
  },
};

describe("scoreDirection", () => {
  it("四项都落在各自的上限内", () => {
    const f = scoreDirection(bullish, "long");
    expect(f.zone).toBeLessThanOrEqual(FACTOR_MAX.zone);
    expect(f.sweep).toBeLessThanOrEqual(FACTOR_MAX.sweep);
    expect(f.oi).toBeLessThanOrEqual(FACTOR_MAX.oi);
    expect(f.cvd).toBeLessThanOrEqual(FACTOR_MAX.cvd);
  });
});

describe("pickDirection", () => {
  it("方向取两边算分较高的那一侧", () => {
    const long = scoreDirection(bullish, "long");
    const short = scoreDirection(bullish, "short");
    const longTotal = long.zone + long.sweep + long.oi + long.cvd;
    const shortTotal = short.zone + short.sweep + short.oi + short.cvd;
    const picked = pickDirection(bullish);
    expect(picked.direction).toBe(longTotal >= shortTotal ? "long" : "short");
  });

  it("总分等于四项之和（取整后允许 1 分以内的差）", () => {
    const p = pickDirection(bullish);
    const sum = p.factors.zone + p.factors.sweep + p.factors.oi + p.factors.cvd;
    expect(Math.abs(p.total - sum)).toBeLessThanOrEqual(1);
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
      liquidation: [],
      taker: [],
      openInterest: undefined,
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
