import { describe, it, expect } from "vitest";
import { buildPriceMap, LIVE_PRICE_REFRESH_MS, LIVE_PRICE_TTL_MS } from "./live-prices";
import { SCAN_INTERVAL_MS } from "./types";
import type { BingXTicker } from "@/types/bingx";

function ticker(symbol: string, lastPrice: string | number): BingXTicker {
  return {
    symbol,
    openPrice: "1",
    highPrice: "1",
    lowPrice: "1",
    lastPrice,
    volume: "1",
    quoteVolume: "1",
    priceChange: "0",
    priceChangePercent: "0",
    closeTime: 0,
  };
}

describe("buildPriceMap", () => {
  it("只收 -USDT 永续，键与 AlertRecord.symbol 同形（含后缀）", () => {
    const { prices } = buildPriceMap(
      [ticker("PUMP-USDT", "0.003279"), ticker("BTC-USDC", "70000")],
      123
    );
    expect(prices).toEqual({ "PUMP-USDT": 0.003279 });
  });

  it("lastPrice 是数字还是字符串都要吃下 —— BingXTicker 把它声明成联合类型", () => {
    const { prices } = buildPriceMap([ticker("A-USDT", 1.5), ticker("B-USDT", "2.5")], 0);
    expect(prices).toEqual({ "A-USDT": 1.5, "B-USDT": 2.5 });
  });

  it("非法价格整条丢掉，不能落成 0", () => {
    // 落成 0 的后果不是「少一个数」而是「错一个数」：卡片会拿它去算
    // signedPct，画出一个 -100% 的暴跌。宁可回落到扫描价。
    const { prices } = buildPriceMap(
      [ticker("A-USDT", "0"), ticker("B-USDT", "-1"), ticker("C-USDT", "abc"), ticker("D-USDT", "5")],
      0
    );
    expect(prices).toEqual({ "D-USDT": 5 });
  });

  it("原样带回取数时刻", () => {
    expect(buildPriceMap([], 1700000000000).at).toBe(1700000000000);
  });
});

describe("刷新节奏", () => {
  it("服务端缓存窗口必须短于客户端轮询间隔", () => {
    // 反过来的话，客户端每次轮询都会命中同一份缓存，画面看着依旧不动——
    // 那正是这次要修的症状，只是从扫描间隔换成了缓存窗口。
    expect(LIVE_PRICE_TTL_MS).toBeLessThan(LIVE_PRICE_REFRESH_MS);
  });

  it("实时价格的节奏与扫描节奏解耦，且快一个数量级以上", () => {
    // 扫描慢是 CoinGlass 配额逼的；BingX 公开行情不花配额，
    // 没有理由让它陪着一起慢。这条用例挡住「顺手把它改成跟扫描同步」。
    expect(LIVE_PRICE_REFRESH_MS).toBeLessThan(SCAN_INTERVAL_MS / 10);
  });
});
