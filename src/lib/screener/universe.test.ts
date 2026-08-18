import { describe, it, expect } from "vitest";
import { preselect, isSyntheticProduct, coinFromBingXSymbol, SERVER_GATE, CLIENT_SLIDER } from "./universe";
import type { MarketCapMap } from "@/lib/market-cap";
import type { BingXTicker } from "@/types/bingx";

function ticker(symbol: string, high: number, low: number): BingXTicker {
  return {
    symbol,
    openPrice: String(low),
    highPrice: String(high),
    lowPrice: String(low),
    lastPrice: high,
    volume: "1000",
    quoteVolume: "10000000",
    priceChange: "0",
    priceChangePercent: "0",
    closeTime: 0,
  };
}

const caps: MarketCapMap = {
  "TIA-USDT": { marketCap: 300_000_000, rank: 120 },
  "BTC-USDT": { marketCap: 1_200_000_000_000, rank: 1 },
  "HUGE-USDT": { marketCap: 900_000_000, rank: 60 },
  "TINY-USDT": { marketCap: 10_000_000, rank: 800 },
  "FLAT-USDT": { marketCap: 200_000_000, rank: 150 },
};

describe("门槛包含关系", () => {
  it("服务端门槛必须比滑块能拉到的最紧值更宽，否则滑块会滑进空池子", () => {
    expect(SERVER_GATE.minVolumeUsd).toBeLessThanOrEqual(CLIENT_SLIDER.volume.min * 1_000_000);
    expect(SERVER_GATE.minMarketCap).toBeLessThan(CLIENT_SLIDER.marketCapFloor.min * 1_000_000);
    expect(SERVER_GATE.maxMarketCap).toBeGreaterThan(CLIENT_SLIDER.marketCapCeiling * 1_000_000);
  });

  it("振幅两边不同源，服务端必须留余量而不是取等值", () => {
    expect(SERVER_GATE.minAmplitude).toBeLessThan(CLIENT_SLIDER.amplitude.min);
  });
});

describe("isSyntheticProduct", () => {
  it("拦住代币化的股票/商品/指数/外汇", () => {
    expect(isSyntheticProduct("NCSK-USDT")).toBe(true);
    expect(isSyntheticProduct("NCCO-USDT")).toBe(true);
    expect(isSyntheticProduct("NCSI-USDT")).toBe(true);
    expect(isSyntheticProduct("NCFX-USDT")).toBe(true);
  });

  it("不误伤 NCASH 这类真实币种", () => {
    expect(isSyntheticProduct("NCASH-USDT")).toBe(false);
  });
});

describe("coinFromBingXSymbol", () => {
  it("剥掉 -USDT 后缀", () => {
    expect(coinFromBingXSymbol("TIA-USDT")).toBe("TIA");
  });

  it("剥掉合约乘数前缀，让它能对上 CoinGlass 的币种名", () => {
    expect(coinFromBingXSymbol("1000PEPE-USDT")).toBe("PEPE");
  });
});

describe("preselect", () => {
  it("放行市值与振幅都达标的币", () => {
    expect(preselect([ticker("TIA-USDT", 1.02, 1)], caps).map((c) => c.coin)).toEqual(["TIA"]);
  });

  it("排除排名前 50 的主流大币", () => {
    expect(preselect([ticker("BTC-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除市值超过上限的大盘币", () => {
    expect(preselect([ticker("HUGE-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除市值低于下限的微型盘", () => {
    expect(preselect([ticker("TINY-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("查不到市值一律排除——下限是必须证明达标的条件", () => {
    expect(preselect([ticker("UNKNOWN-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除振幅不足的币", () => {
    expect(preselect([ticker("FLAT-USDT", 1.001, 1)], caps)).toHaveLength(0);
  });

  it("排除非 -USDT 交易对", () => {
    expect(preselect([ticker("TIA-USDC", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除合成品", () => {
    expect(preselect([ticker("NCSK-USDT", 1.5, 1)], caps)).toHaveLength(0);
  });

  it("同一个币只出现一次", () => {
    expect(preselect([ticker("TIA-USDT", 1.02, 1), ticker("TIA-USDT", 1.03, 1)], caps)).toHaveLength(1);
  });
});
