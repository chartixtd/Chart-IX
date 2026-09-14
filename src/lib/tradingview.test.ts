import { describe, it, expect } from "vitest";
import { tradingViewSymbol, tradingViewInterval, tradingViewChartUrl } from "./tradingview";

describe("tradingViewSymbol（加密）", () => {
  it("现货与模拟盘不带 .P，永续带", () => {
    // 模拟盘读的是现货 K 线，标成永续会跟站内那张图对不上
    expect(tradingViewSymbol("BTC-USDT", "spot")).toBe("BINGX:BTCUSDT");
    expect(tradingViewSymbol("BTC-USDT", "paper")).toBe("BINGX:BTCUSDT");
    expect(tradingViewSymbol("BTC-USDT", "futures")).toBe("BINGX:BTCUSDT.P");
  });

  it("USDC 盘与合约乘数原样保留", () => {
    expect(tradingViewSymbol("ETH-USDC", "spot")).toBe("BINGX:ETHUSDC");
    // TradingView 的 BingX 源里就叫 1000PEPEUSDT.P，剥掉乘数反而查不到
    expect(tradingViewSymbol("1000PEPE-USDT", "futures")).toBe("BINGX:1000PEPEUSDT.P");
  });
});

describe("tradingViewSymbol（代币化标的）", () => {
  it("大宗商品与股指走人工表——TradingView 的 BingX 源里没有这些", () => {
    expect(tradingViewSymbol("NCCOGOLD2USD-USDT", "futures", "GOLD(XAU)-USDT")).toBe("TVC:GOLD");
    expect(tradingViewSymbol("NCCO1OILWTI2USD-USDT", "futures", "Oil WTI-USDT")).toBe("TVC:USOIL");
    expect(tradingViewSymbol("NCSISP5002USD-USDT", "futures", "SP500-USDT")).toBe("SP:SPX");
    expect(tradingViewSymbol("NCSINASDAQ1002USD-USDT", "futures", "NASDAQ100-USDT")).toBe("NASDAQ:NDX");
  });

  it("美股用 symbol 推名，不用 displayName", () => {
    // BingX 给撞代号的股票加了 US 后缀，照搬 displayName 会得到查不到的 AMDUS
    expect(tradingViewSymbol("NCSKAMD2USD-USDT", "futures", "AMDUS-USDT")).toBe("AMD");
    expect(tradingViewSymbol("NCSKAAPL2USD-USDT", "futures", "AAPL-USDT")).toBe("AAPL");
    expect(tradingViewSymbol("NCSKKODEX2002USD-USDT", "futures", "KODEX200-USDT")).toBe("KODEX200");
  });

  it("外汇与金银交叉盘用 displayName，那本身就是 OANDA 认的代码", () => {
    expect(tradingViewSymbol("NCFXEUR2USD-USDT", "futures", "EURUSD-USDT")).toBe("EURUSD");
    expect(tradingViewSymbol("NCCOXAUJPY2USD-USDT", "futures", "XAUJPY-USDT")).toBe("XAUJPY");
    expect(tradingViewSymbol("NCSIEWY2USD-USDT", "futures", "EWY-USDT")).toBe("EWY");
  });

  it("合约列表还没到手时也得推得出名字", () => {
    // 打开页面的头几百毫秒 displayName 是 undefined，这时按钮不能给出坏链接
    expect(tradingViewSymbol("NCFXEUR2JPY-USDT", "futures")).toBe("EURJPY");
    expect(tradingViewSymbol("NCFXEUR2USD-USDT", "futures")).toBe("EURUSD");
    expect(tradingViewSymbol("NCFXUSDBRL2USD-USDT", "futures")).toBe("USDBRL");
    expect(tradingViewSymbol("NCCOXAU2TRY-USDT", "futures")).toBe("XAUTRY");
    expect(tradingViewSymbol("NCSKNVDA2USD-USDT", "futures")).toBe("NVDA");
  });

  it("带括号或空格的 displayName 不当代码用", () => {
    // "Nickel(XNI)" / "Nikkei 225" 不是任何交易所的代码——这类必须落到人工表
    expect(tradingViewSymbol("NCCONICKEL2USD-USDT", "futures", "Nickel(XNI)-USDT")).toBe("LME:NI1!");
    expect(tradingViewSymbol("NCSINIKKEI2252USD-USDT", "futures", "Nikkei 225-USDT")).toBe("TVC:NI225");
  });
});

describe("tradingViewInterval", () => {
  it("日内换成分钟数，日线以上换成字母", () => {
    expect(tradingViewInterval("1m")).toBe("1");
    expect(tradingViewInterval("1h")).toBe("60");
    expect(tradingViewInterval("12h")).toBe("720");
    expect(tradingViewInterval("1d")).toBe("D");
    expect(tradingViewInterval("1w")).toBe("W");
  });

  it("认不出的周期返回 undefined，链接就不带这个参数", () => {
    expect(tradingViewInterval("1M")).toBeUndefined();
  });
});

describe("tradingViewChartUrl", () => {
  it("走 https 图表页——装了 App 的平台由系统自己接管", () => {
    expect(tradingViewChartUrl({ symbol: "BTC-USDT", interval: "1h", market: "futures" })).toBe(
      "https://www.tradingview.com/chart/?symbol=BINGX%3ABTCUSDT.P&interval=60"
    );
  });

  it("周期认不出时只带 symbol", () => {
    expect(tradingViewChartUrl({ symbol: "BTC-USDT", interval: "1M", market: "spot" })).toBe(
      "https://www.tradingview.com/chart/?symbol=BINGX%3ABTCUSDT"
    );
  });
});
