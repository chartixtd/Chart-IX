import { describe, it, expect } from "vitest";
import {
  preselect,
  isSyntheticProduct,
  coinFromBingXSymbol,
  amplitudeFromTicker,
  SERVER_GATE,
} from "./universe";
import { DEFAULT_FILTERS } from "./filter";
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
  it("客户端只剩方向可调，三条门槛全部在服务端执行", () => {
    // 固定下来的门槛留在客户端是双重损失：既浪费深度扫描名额（选中的币
    // 可能一进来就被滤掉），又让用户以为它可调。
    // T24 之后连振幅那个滑块也删了（选币已经按振幅排名，客户端再筛一次
    // 是空操作）。FilterState 只剩 direction 一个键，这条断言防止以后
    // 有人顺手把任何一条门槛加回客户端。
    expect(Object.keys(DEFAULT_FILTERS)).toEqual(["direction"]);
  });

  it("服务端不该再有振幅门槛或 BingX 成交额代理门槛", () => {
    // 两条都在 T24 删了，理由见 SERVER_GATE 下方的注释块（都是实测的）：
    // 振幅门槛一个币都没筛掉且筛选强度随行情漂移，已改成排名；
    // BingX 成交额与全市场成交额的倍数从 1.3x 到 28.3x，代理不成立，
    // 现在由 screener_volume_cache 提供真实成交量。
    // 这条断言防止以后有人「顺手加回一个粗筛门槛」——那会重新引入
    // 一个看不见的、随行情漂移的筛选层。
    expect(SERVER_GATE).not.toHaveProperty("minAmplitude");
    expect(SERVER_GATE).not.toHaveProperty("minBingxVolumeUsd");
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

  it("主流大币不再被排除——「前 50 名不要」这条规则已经去掉", () => {
    // 这条断言以前是反的（BTC 必须被挡掉）。候选池现在没有任何市值上限：
    // 先是 5 亿的上限被删，接着「CoinGecko 前 50 名排除」也被删，
    // 大币只要满足市值下限与成交量门槛就能进。
    expect(preselect([ticker("BTC-USDT", 1.02, 1)], caps).map((c) => c.coin)).toEqual(["BTC"]);
  });

  it("市值没有上限", () => {
    // HUGE-USDT 市值 9 亿、排名 60。早期版本有一条 5 亿的上限会把它挡掉。
    expect(preselect([ticker("HUGE-USDT", 1.02, 1)], caps).map((c) => c.coin)).toEqual(["HUGE"]);
  });

  it("排除市值低于下限的微型盘", () => {
    expect(preselect([ticker("TINY-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("查不到市值一律排除——下限是必须证明达标的条件", () => {
    expect(preselect([ticker("UNKNOWN-USDT", 1.02, 1)], caps)).toHaveLength(0);
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

  it("不再因为 BingX 成交额低就排除——真实成交量门槛在缓存那一层执行", () => {
    // BingX 长尾的 quoteVolume 是被拍平的假数据，拿它筛成交额等于用假数据
    // 决定谁进池子。这里放行，由 pipeline 用 screener_volume_cache 里的
    // 全市场真实成交额来筛。
    expect(preselect([ticker("TIA-USDT", 1.02, 1, 500_000)], caps)).toHaveLength(1);
  });

  it("不再因为振幅低就排除——振幅现在是排名依据，不是门槛", () => {
    // high/low 几乎相等 = 振幅接近 0，旧门槛会砍掉它。
    expect(preselect([ticker("TIA-USDT", 1.0001, 1, 50_000_000)], caps)).toHaveLength(1);
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
