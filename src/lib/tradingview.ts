/**
 * 「在 TradingView 里打开当前这张图」——把本站的 BingX symbol 翻译成
 * TradingView 认识的 symbol，再拼出一条图表链接。
 *
 * ## 为什么只给一条 https 链接，而不是先试 App 的自定义协议
 *
 * 需求是「手机/电脑装了 TradingView 就开 App，没装就走网页」。实测下来，
 * 这件事**不该由我们写跳转逻辑**，交给系统的 App Link 反而全中：
 *
 * - **Android**：`https://www.tradingview.com/.well-known/assetlinks.json`
 *   里 `com.tradingview.tradingviewapp` 声明了 `handle_all_urls`——装了 App
 *   的机器点这条 https 链接，系统直接把它交给 App；没装就留在浏览器。
 * - **iOS**：`https://www.tradingview.com/apple-app-site-association` 里
 *   `/chart/` 带 `symbol=?*` 这一条是 **`exclude: true`**——TradingView 自己
 *   明确把「带 symbol 的图表链接」排除在 Universal Link 之外。也就是说
 *   iPhone 上这条链接会留在 Safari，这是对方的设计，不是我们能绕开的。
 *   （另一条路 `tradingview://chart?symbol=…` 没有官方 iOS 路由；乱发一个
 *   未注册的 scheme 只会弹「Safari 打不开该网址」。）
 * - **桌面**：TradingView Desktop 的 `tradingview://` 处理器只接登录回调
 *   （auth redirect），不开图表标签页；Windows 版另有一个「in-app link
 *   handling」开关，由系统把 tradingview.com 链接交给 App。同样是系统层
 *   的事，我们发普通 https 链接即可。
 *
 * 结论：一条 `target="_blank"` 的 https 链接，能开 App 的平台自己会开。
 *
 * ## symbol 怎么翻译
 *
 * 加密走 BingX 自己的行情源（`BINGX:BTCUSDT` / 永续 `BINGX:BTCUSDT.P`，
 * 2026-09-14 在 TradingView 的 symbol-search 上逐条核过，1000PEPE 这类带
 * 合约乘数的也在），图表跟站内看到的是同一个盘口。
 *
 * 代币化标的（NCCO/NCSI/NCFX/NCSK，见 src/lib/instruments.ts）TradingView
 * 的 BingX 源里**一条都没有**（搜 NCCO/NCSK 返回 0 条），只能映射到真正的
 * 底层：黄金→`TVC:GOLD`、标普→`SP:SPX`、AAPL→`AAPL`。
 */

import { classifyInstrument } from "./instruments";

/**
 * BingX K 线周期 → TradingView `?interval=`。
 * TradingView 用分钟数表示日内周期，日线以上用 D/W 字母。
 */
const TV_INTERVAL: Record<string, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "8h": "480",
  "12h": "720",
  "1d": "D",
  "3d": "3D",
  "1w": "W",
};

/**
 * 大宗商品与指数：BingX symbol → TradingView symbol。
 *
 * 这张表只能人工维护——BingX 给的是 `GOLD(XAU)` 这种带括号的俗名，不是任何
 * 交易所的代码。表里每一条都在 TradingView 的 symbol-search 上验过存在
 * （`1!` 是连续主力合约，搜索接口只索引根代码 `HG`/`ZW`，图表侧照常可用）。
 *
 * 黄金/白银的交叉盘（XAUEUR、XAGJPY 等）刻意不进表：它们的 displayName
 * 本身就是 OANDA 能解析的代码，走下面的通用兜底即可。
 */
const TOKENIZED_TV_SYMBOL: Record<string, string> = {
  // —— 贵金属与能源。TVC 是 TradingView 自家的现货指数源，无合约换月缺口 ——
  "NCCOGOLD2USD-USDT": "TVC:GOLD",
  "NCCOXAG2USD-USDT": "TVC:SILVER",
  "NCCOXPT2USD-USDT": "TVC:PLATINUM",
  "NCCOPALLADIUM2USD-USDT": "TVC:PALLADIUM",
  "NCCO1OILWTI2USD-USDT": "TVC:USOIL",
  "NCCO1OILBRENT2USD-USDT": "TVC:UKOIL",
  "NCCO7241NATGAS2USD-USDT": "NYMEX:NG1!",
  "NCCOGASOLINE2USD-USDT": "NYMEX:RB1!",
  "NCCOHEATINGOIL2USD-USDT": "NYMEX:HO1!",
  // —— 工业金属。裸名字会落到 MCX（印度卢比计价的镍/锌），不是这里要的 ——
  "NCCO724COPPER2USD-USDT": "COMEX:HG1!",
  "NCCOALUMINIUM2USD-USDT": "COMEX:ALI1!",
  "NCCONICKEL2USD-USDT": "LME:NI1!",
  "NCCOZINC2USD-USDT": "LME:ZS1!",
  "NCCOLEAD2USD-USDT": "LME:PB1!",
  // —— 农产品 ——
  "NCCOWHEAT2USD-USDT": "CBOT:ZW1!",
  "NCCOSOYBEANS2USD-USDT": "CBOT:ZS1!",
  "NCCOCOFFEE2USD-USDT": "ICEUS:KC1!",
  "NCCOCOCOA2USD-USDT": "ICEUS:CC1!",
  "NCCOSUGAR2USD-USDT": "ICEUS:SB1!",
  "NCCOCOTTON2USD-USDT": "ICEUS:CT1!",
  // —— 股指。名字（NASDAQ100 / SP500 / DowJones）没有一个是 TradingView
  //     的代码，裸搜会命中一堆同名 ETF 与结构化票，必须写死 ——
  "NCSINASDAQ1002USD-USDT": "NASDAQ:NDX",
  "NCSISP5002USD-USDT": "SP:SPX",
  "NCSIDOWJONES2USD-USDT": "TVC:DJI",
  "NCSIRUSSELL20002USD-USDT": "TVC:RUT",
  "NCSINIKKEI2252USD-USDT": "TVC:NI225",
  "NCSIDXY2USD-USDT": "TVC:DXY",
  "NCSIGER2USD-USDT": "XETR:DAX",
  "NCSIUK2USD-USDT": "FTSE:UKX",
  "NCSIEUSTX2USD-USDT": "TVC:SX5E",
  "NCSIKOSPI12USD-USDT": "KRX:KOSPI",
  "NCSIKOSPI2USD-USDT": "KRX:KOSPI200",
  "NCSINIFTY52USD-USDT": "NSE:NIFTY",
  "NCSINIFTYBK2USD-USDT": "NSE:BANKNIFTY",
};

/**
 * 代币化标的的兜底名：优先用合约的 `displayName`（BingX 原样给的
 * `EURUSD-USDT` / `AAPL-USDT`），拿不到再从 symbol 上现推。
 *
 * 不带交易所前缀是故意的——TradingView 会按自己的搜索排序解析裸代码，
 * `AAPL` 落到 NASDAQ、`EURUSD` 落到 OANDA、`EWY` 落到 NYSE Arca，比我们
 * 给 496 只代币化美股逐个猜上市所靠谱。
 */
function underlyingTicker(symbol: string, displayName?: string): string {
  const bare = symbol.replace(/-USDT$/, "");
  const nc = /^NC(?:SK|CO|SI|FX)(.+)$/.exec(bare);

  // 美股只信 symbol：BingX 给撞代号的股票加了 US 后缀（AMD → displayName
  // "AMDUS"、OPEN → "OPENUS"），照搬会得到 TradingView 查不到的代码，而
  // symbol 上剥出来的正好是干净的 AMD / OPEN。
  if (nc && symbol.startsWith("NCSK")) {
    return nc[1].replace(/(?:2USD|USDT)$/, "");
  }

  const fromDisplay = displayName?.replace(/-USDT$/, "").trim();
  // 括号（"GOLD(XAU)"）与空格（"Nikkei 225"）都不是合法代码——这些本该在
  // 上面那张表里，落到这儿说明是新上的品种，宁可退回 symbol 推名。
  if (fromDisplay && /^[A-Za-z0-9.]{1,16}$/.test(fromDisplay)) return fromDisplay;

  if (!nc) return bare;
  const base = nc[1].replace(/(?:2USD|USDT)$/, "");
  // 外汇与金属交叉盘在 symbol 里用 "2" 当分隔符：EUR2JPY → EURJPY。
  // 但 EUR2USD 的尾巴已经被上一行当成计价标记剥掉了（得到 "EUR"），
  // 所以只在剥完仍剩 "X2Y" 形态时才拼接，剥剩 3 位的补回 USD。
  if (/^[A-Z]{3}2[A-Z]{3}$/.test(base)) return base.replace("2", "");
  if (/^[A-Z]{3}$/.test(base) && /2USD$/.test(nc[1])) return `${base}USD`;
  return base;
}

/** 站内 symbol + 市场 → TradingView symbol。`market` 只区分永续与现货。 */
export function tradingViewSymbol(symbol: string, market: string, displayName?: string): string {
  if (classifyInstrument(symbol) === "crypto") {
    // 模拟盘用的是现货 K 线（见 api/bingx/market/klines），所以只有 futures
    // 才是永续；标成 .P 会让模拟盘看到一张跟站内不同的图。
    const [base, quote = "USDT"] = symbol.split("-");
    return `BINGX:${base}${quote}${market === "futures" ? ".P" : ""}`;
  }
  return TOKENIZED_TV_SYMBOL[symbol] ?? underlyingTicker(symbol, displayName);
}

/** 站内 K 线周期 → TradingView 周期；没有对应的就不带这个参数。 */
export function tradingViewInterval(interval: string): string | undefined {
  return TV_INTERVAL[interval];
}

/**
 * 当前这张图在 TradingView 上的地址。
 * 装了 App 的 Android / Windows 由系统接管，其余平台落到网页版——见文件头。
 */
export function tradingViewChartUrl({
  symbol,
  interval,
  market,
  displayName,
}: {
  symbol: string;
  interval: string;
  market: string;
  displayName?: string;
}): string {
  const params = new URLSearchParams({ symbol: tradingViewSymbol(symbol, market, displayName) });
  const tvInterval = tradingViewInterval(interval);
  if (tvInterval) params.set("interval", tvInterval);
  return `https://www.tradingview.com/chart/?${params.toString()}`;
}
