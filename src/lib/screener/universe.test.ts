import { describe, it, expect } from "vitest";
import {
  preselect,
  assetClassOf,
  sameInstrument,
  displayName,
  PRICE_SANITY_MAX_DEV,
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

describe("assetClassOf", () => {
  it("NCCO 是大宗商品", () => {
    expect(assetClassOf("NCCOGOLD2USD-USDT")).toBe("commodity");
    expect(assetClassOf("NCCO1OILWTI2USD-USDT")).toBe("commodity");
  });

  it("个股与指数 ETF 都归股票那一栏", () => {
    expect(assetClassOf("NCSKNVDA2USD-USDT")).toBe("stock");
    expect(assetClassOf("NCSISP5002USD-USDT")).toBe("stock");
  });

  it("外汇排除在外（不在需求里）", () => {
    expect(assetClassOf("NCFXEURUSD2USD-USDT")).toBeNull();
  });

  it("不误伤 NCASH 这类真实币种", () => {
    expect(assetClassOf("NCASH-USDT")).toBe("crypto");
    expect(assetClassOf("BTC-USDT")).toBe("crypto");
  });
});

describe("coinFromBingXSymbol", () => {
  it("剥掉 -USDT 后缀", () => {
    expect(coinFromBingXSymbol("TIA-USDT")).toBe("TIA");
  });

  it("剥掉合约乘数前缀，让它能对上 CoinGlass 的币种名", () => {
    expect(coinFromBingXSymbol("1000PEPE-USDT")).toBe("PEPE");
  });

  it("剥掉代币化标的的 NC 前缀与计价尾巴", () => {
    expect(coinFromBingXSymbol("NCSKNVDA2USD-USDT")).toBe("NVDA");
    expect(coinFromBingXSymbol("NCSKTBTUSDT-USDT")).toBe("TBT");
  });

  it("尾巴只从末尾剥，KODEX200 不能被剥成 KODEX", () => {
    expect(coinFromBingXSymbol("NCSKKODEX2002USD-USDT")).toBe("KODEX200");
  });

  it("俗名映射到 CoinGlass 的交易代码", () => {
    expect(coinFromBingXSymbol("NCCOGOLD2USD-USDT")).toBe("XAU");
    expect(coinFromBingXSymbol("NCCO1OILWTI2USD-USDT")).toBe("CL");
    expect(coinFromBingXSymbol("NCCO1OILBRENT2USD-USDT")).toBe("BZ");
  });

  // 撞名是这张别名表存在的主要理由：不改号的话，代币化的昆泰/思睿驰/黑莓
  // 会去拉 Quant / Stacks / BounceBit 这三个**加密货币**的 OI 与 CVD，
  // 不报错，只是整行数据是别的标的的。
  it("撞名的股票走 CoinGlass 的改号，不去拉同名的币", () => {
    expect(coinFromBingXSymbol("NCSKQNT2USD-USDT")).toBe("QNTX");
    expect(coinFromBingXSymbol("NCSKSTX2USD-USDT")).toBe("STXX");
    expect(coinFromBingXSymbol("NCSKBB2USD-USDT")).toBe("BBX");
    // 同名的真币本身不受影响
    expect(coinFromBingXSymbol("QNT-USDT")).toBe("QNT");
    expect(coinFromBingXSymbol("STX-USDT")).toBe("STX");
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

  // 代币化标的不再被整体排除，改成分到自己那一栏；市值那道门对它们不生效
  // （CoinGlass 期货接口对 TradFi 一律返回 0 市值，硬套只会全灭或拿同名币
  // 的市值冒充）。它们的流动性门槛完全由成交额那一条撑着。
  it("代币化的商品与股票进池子，并带上自己的分类", () => {
    const rows = preselect(
      [ticker("NCCOGOLD2USD-USDT", 4356, 1), ticker("NCSKNVDA2USD-USDT", 215, 1)],
      caps
    );
    expect(rows.map((r) => [r.coin, r.assetClass])).toEqual([
      ["XAU", "commodity"],
      ["NVDA", "stock"],
    ]);
  });

  it("代币化标的的市值写 0，不去 CoinGecko 捞同名币的市值", () => {
    // NVDA / META / HOOD / SPY 等 15 个代号在 CoinGecko 前 1000 名里
    // 都真的有同名的加密货币，拿它们的市值冒充是静默的错值。
    const [row] = preselect([ticker("NCSKNVDA2USD-USDT", 215, 1)], caps);
    expect(row.marketCap).toBe(0);
    expect(row.marketCapRank).toBe(0);
  });

  it("外汇仍然整体排除", () => {
    expect(preselect([ticker("NCFXEURUSD2USD-USDT", 1.08, 1)], caps)).toHaveLength(0);
  });

  it("加密仍然必须证明市值达标", () => {
    expect(preselect([ticker("UNKNOWN-USDT", 1.5, 1)], caps)).toHaveLength(0);
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

describe("sameInstrument（代号撞车探测）", () => {
  it("抓住真实发生的那一个：雪佛龙 vs Convex Finance", () => {
    // BingX NCSKCVX2USD-USDT = 雪佛龙 $212.11
    // CoinGlass CVX          = Convex Finance $2.127
    expect(sameInstrument(212.11, 2.127)).toBe(false);
  });

  it("同一个标的的正常报价差放行", () => {
    expect(sameInstrument(215.77, 215.71)).toBe(true);
    // 参考价最旧可能是半小时前的，10% 的真实波动不该被当成撞名
    expect(sameInstrument(110, 100)).toBe(true);
  });

  it("阈值是包含边界的 ≤，不是 <", () => {
    expect(sameInstrument(100 * (1 + PRICE_SANITY_MAX_DEV / 100), 100)).toBe(true);
    expect(sameInstrument(100 * (1 + PRICE_SANITY_MAX_DEV / 100) + 0.01, 100)).toBe(false);
  });

  it("没有参考价时放行——缺证据不等于有问题", () => {
    // 这跟成交量那道门刻意相反：那是流动性门槛，「证明不了达标」就该当
    // 不达标；这是错配探测，把「没探测过」当成「探测到了」会无故删行。
    expect(sameInstrument(212.11, null)).toBe(true);
    expect(sameInstrument(212.11, 0)).toBe(true);
    expect(sameInstrument(212.11, NaN)).toBe(true);
  });

  it("BingX 报价本身非法时放行——那条由价格校验单独负责", () => {
    expect(sameInstrument(0, 100)).toBe(true);
    expect(sameInstrument(NaN, 100)).toBe(true);
  });
});

describe("displayName（榜单/卡片/推送上写什么名字）", () => {
  it("代币化标的用 coin，不是去掉 -USDT 的那一坨", () => {
    // 去 -USDT 会得到 NCSKAAPL2USD / NCCOGOLD2USD，没人读得懂
    expect(displayName("NCSKAAPL2USD-USDT", "AAPL")).toBe("AAPL");
    expect(displayName("NCCOGOLD2USD-USDT", "XAU")).toBe("XAU");
    expect(displayName("NCSISP5002USD-USDT", "SP500")).toBe("SP500");
  });

  it("加密维持原样——合约乘数必须看得见", () => {
    // 卡片上那个价格就是 1000 倍的合约价，标成 PEPE 会让人按现货价读它
    expect(displayName("1000PEPE-USDT", "PEPE")).toBe("1000PEPE");
    expect(displayName("BTC-USDT", "BTC")).toBe("BTC");
  });
});
