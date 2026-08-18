import { describe, it, expect } from "vitest";
import {
  preselect,
  isSyntheticProduct,
  coinFromBingXSymbol,
  amplitudeFromTicker,
  SERVER_GATE,
  CLIENT_SLIDER,
} from "./universe";
import type { MarketCapMap } from "@/lib/market-cap";
import type { BingXTicker } from "@/types/bingx";

function ticker(symbol: string, high: number, low: number, quoteVolume = 10_000_000): BingXTicker {
  return {
    symbol,
    openPrice: String(low),
    highPrice: String(high),
    lowPrice: String(low),
    lastPrice: high,
    volume: "1000",
    quoteVolume: String(quoteVolume),
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
  it("成交量与市值已固定成服务端门槛，客户端不该再有对应的滑块", () => {
    // 固定下来的门槛留在客户端是双重损失：既浪费深度扫描名额（选中的币
    // 可能一进来就被滤掉），又让用户以为它可调。这条断言防止以后有人
    // 顺手把它们加回滑块而没有同步去掉服务端那一份。
    expect(CLIENT_SLIDER).not.toHaveProperty("volume");
    expect(CLIENT_SLIDER).not.toHaveProperty("marketCapFloor");
    expect(CLIENT_SLIDER).not.toHaveProperty("marketCapCeiling");
  });

  it("BingX 成交额粗筛门槛必须定在假带（619万–691万）下方，不能顶到假带里", () => {
    expect(SERVER_GATE.minBingxVolumeUsd).toBeLessThan(6_190_000);
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

  it("市值没有上限——大市值币只要不在前 50 名就照样进候选池", () => {
    // HUGE-USDT 市值 9 亿、排名 60。早期版本有一条 5 亿的上限会把它挡掉，
    // 现在挡大币的只剩「前 50 名」这一条规则。
    expect(preselect([ticker("HUGE-USDT", 1.02, 1)], caps).map((c) => c.coin)).toEqual(["HUGE"]);
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

  it("排除 BingX quoteVolume 低于门槛的币（真正没有成交）", () => {
    expect(preselect([ticker("TIA-USDT", 1.02, 1, 500_000)], caps)).toHaveLength(0);
  });

  it("quoteVolume 恰好达标时放行", () => {
    expect(
      preselect([ticker("TIA-USDT", 1.02, 1, SERVER_GATE.minBingxVolumeUsd)], caps)
    ).toHaveLength(1);
  });
});

describe("amplitudeFromTicker", () => {
  it("按 24h 高低算出振幅百分比", () => {
    expect(amplitudeFromTicker(ticker("TIA-USDT", 110, 100))).toBeCloseTo(10);
  });

  it("高低价非法时返回 0，而不是 NaN 或抛错", () => {
    expect(amplitudeFromTicker(ticker("TIA-USDT", NaN, 100))).toBe(0);
    expect(amplitudeFromTicker(ticker("TIA-USDT", 110, 0))).toBe(0);
  });
});
