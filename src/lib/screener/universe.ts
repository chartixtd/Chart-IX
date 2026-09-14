import { stripContractMultiplier } from "@/lib/market-cap";
import type { MarketCapMap } from "@/lib/market-cap";
import type { BingXTicker } from "@/types/bingx";

/**
 * 服务端门槛：只负责挡掉明显不合格的候选（不可交易、合成品、市值不达标、
 * 完全没有成交等），不负责表达用户口味，也不再负责把池子收到某个具体行数——
 * T19 之后真正决定「最终能看到几行」的是预排序从这个池子里选出的
 * `AMPLITUDE_RANK_TAKE` 个（见 pipeline.ts 的 buildScanTargets）。
 * 真正的筛选口味在客户端滑块上——服务端对选中的这些候选各算一次分，
 * 滑块只决定哪些行显示，所以拉动滑块不会改变任何币的分数，也不会改变警报触发。
 */
export const SERVER_GATE = {
  /**
   * 全交易所 volume_usd 之和的下限。
   *
   * 这条门槛**现在在全池生效**（T24）。此前它只能在行情层执行——CoinGlass
   * 的成交额要逐币调 pairs-markets 才有，一轮扫描的配额装不下两百多个币，
   * 所以只对已经选中的那十几个生效，结果是名额被浪费：选中了，进来才发现
   * 不达标，这一轮就少一行。
   *
   * 现在由 screener_volume_cache 供数（见 volume-cache.ts）：cron 空转的
   * tick 轮转刷新，约半小时刷一遍全池，扫描时零配额读缓存。
   *
   * 查不到缓存的币一律排除，与 minMarketCap 同一条原则——下限是「必须
   * 证明达标」的条件，证明不了就当不达标。新上市的币会在下一次轮转
   * 刷到它之后进入候选。
   */
  minVolumeUsd: 20_000_000,
  /**
   * 市值下限。3000万以下的盘子太容易被单笔资金推动，日内进出容易被埋。
   *
   * **刻意没有上限，而且现在连「排名前 50 不要」这条也去掉了。**
   * 早期版本先是有一条 5 亿的市值上限（用来把产品钉在「小市值币扫描器」
   * 这个定位上），后来换成「CoinGecko 前 50 名排除」，现在两条都没有了——
   * 候选池的上界只剩「成交量与压缩度排得上号」。
   *
   * 这条在粗筛阶段生效（CoinGecko 市值是免费数据，不花 CoinGlass 配额）。
   */
  minMarketCap: 30_000_000,
} as const;

/*
 * 这里曾经还有两条门槛，T24 一并删除，删除的理由都是实测的：
 *
 * · `minAmplitude: 0.5`（BingX 24h 高低算出的振幅下限）——实测**一个币
 *   都没筛掉**。真实候选池 252 个币的振幅最小值就有 2.63%，中位数 9.7%，
 *   加密货币一天不动 1.5% 才是稀奇事。而且固定门槛在不同行情下筛掉的
 *   比例天差地别：同样一条 8%，过去七天有 76% 的时点在它之下，而大行情
 *   日只有 27%。振幅现在改成**排名**（见 pipeline.ts 的选币段），
 *   不管行情火爆还是平静，选出来的数量都稳定。
 *
 * · `minBingxVolumeUsd: 2_000_000`——它只是 minVolumeUsd 在粗筛阶段的
 *   粗略代理，而实测证明这个代理不成立：同一批币两个口径的倍数从 1.3x
 *   到 28.3x（CRV 在 BingX 只有 3.4M、全市场 96.4M；WET 在 BingX 6.5M、
 *   全市场只有 8.7M），没有任何 BingX 门槛能翻译成「全市场 ≥2000万」。
 *   更糟的是 BingX 长尾的成交额是被拍平的假数据（516 个永续里 144 个
 *   全挤在 619–691 万这个 0.73M 宽的带里）。现在有了真实成交量缓存，
 *   代理不再需要。
 */

/*
 * 这里曾经有一个 `CLIENT_SLIDER`，唯一的成员是振幅滑块（1.5–3%）。
 * T24 删除：选币改成「按振幅排名取前 AMPLITUDE_RANK_TAKE 个」之后，
 * 能进榜的行振幅实测都在 14% 以上，滑块拉到头也筛不掉任何一行。
 * 界面上现在只剩方向切换是可调的，成交量/市值/振幅三条都是只读说明。
 */

/**
 * 榜单的三个分栏。每一栏独立排名、独立占名额（见 pipeline.ts 的
 * `CLASS_TABLE_TAKE`），互相不挤。
 *
 * 分栏不只是展示上的分组，它同时解决一个排序上的真问题：压缩度
 * （6h振幅 ÷ 24h振幅）是**无量纲比值**，而三类标的的振幅量级差着数倍
 * （实测 2026-09-14 全池：加密中位 6.17%、代币化股票中位 1.70%）。
 * 混在一张表里按压缩度排，美股休市那几十个小时会整片压到榜首——实测
 * 周日全池前 20 名里有 14 个是代币化股票，前三名的 6h 振幅精确等于 0.00。
 * 分栏之后每一栏只跟自己比，加密那一栏不会再被污染。
 */
export type AssetClass = "crypto" | "commodity" | "stock";

/**
 * BingX 在永续里混了一批代币化的传统资产，用四个前缀区分：
 * NCSK=个股/ETF、NCCO=大宗商品、NCSI=指数、NCFX=外汇。
 *
 * 分类映射：
 *   NCCO        → commodity（金银油气铜，"大宗商品"栏）
 *   NCSK / NCSI → stock（个股与指数 ETF 合并成"股票"栏——SPY/QQQ 这类
 *                 指数 ETF 本身就是在美股交易所挂牌的股票，跟着同一个开收盘）
 *   NCFX        → null（外汇没在需求里，继续排除）
 *   其余        → crypto
 *
 * 用四个明确前缀而不是裸 "NC"，避免误伤 NCASH 这类真实币种。
 */
export function assetClassOf(symbol: string): AssetClass | null {
  const m = /^NC(SK|CO|SI|FX)/.exec(symbol);
  if (!m) return "crypto";
  if (m[1] === "CO") return "commodity";
  if (m[1] === "FX") return null;
  return "stock";
}

/**
 * BingX 给代币化标的的命名 → CoinGlass / Binance 的命名。
 *
 * **这张表只能人工维护，没有规则能推出来。** 两类情况：
 *
 * ① 同一个标的两边叫法不同（BingX 用俗名，CoinGlass 用交易代码）：
 *    GOLD→XAU、PALLADIUM→XPD、1OILWTI→CL、1OILBRENT→BZ。
 *
 * ② **撞名改号。** CoinGlass/Binance 给那些跟真实币种撞代号的股票另起了
 *    代号，BingX 没跟着改：
 *      QNT  = Quant（币）        昆泰（股）在 CoinGlass 叫 QNTX
 *      STX  = Stacks（币）       思睿驰（股）叫 STXX
 *      BB   = BounceBit（币）    黑莓（股）叫 BBX
 *    不映射的话，`NCSKQNT2USD-USDT` 会去拉 Quant 这个**加密货币**的
 *    OI 与 CVD——不报错，只是数据整个是错的。
 *
 * 反向陷阱记在这里，免得以后有人"补全"这张表时踩进去：**不要把
 * `SP500` 映射到 `SPX`**。Binance 的 `SPXUSDT` 的 `underlyingSubType`
 * 是 `Meme/Crypto`，那是 SPX6900 这个 meme 币，不是标普 500 指数。
 * 没有别名的标的走下面的兜底：查不到成交量缓存就自动出局，
 * 这比编一个映射安全。
 */
const NC_COIN_ALIAS: Record<string, string> = {
  GOLD: "XAU",
  PALLADIUM: "XPD",
  "1OILWTI": "CL",
  "1OILBRENT": "BZ",
  "7241NATGAS": "NATGAS",
  "724COPPER": "COPPER",
  QNT: "QNTX",
  STX: "STXX",
  BB: "BBX",
};

/**
 * BingX 永续 symbol → CoinGlass 币种名。
 *
 * 加密：抹平 -USDT 后缀与 1000PEPE 这种合约乘数前缀
 * （CoinGlass 那边叫 PEPE，对不上就整个币拿不到任何明细数据）。
 *
 * 代币化标的：还要多剥两层——`NCSK`/`NCCO`/`NCSI` 前缀，以及尾部的
 * `2USD` 或 `USDT` 计价标记（`NCSKNVDA2USD-USDT` → `NVDA`、
 * `NCSKTBTUSDT-USDT` → `TBT`），然后过一遍上面的别名表。
 * 剥尾巴要用锚定到末尾的正则，否则 `NCSKKODEX2002USD-USDT`
 * 会被剥成 `KODEX`（正确答案是 `KODEX200`）。
 */
export function coinFromBingXSymbol(symbol: string): string {
  const bare = symbol.replace(/-USDT$/, "");
  const nc = /^NC(?:SK|CO|SI|FX)(.+)$/.exec(bare);
  if (!nc) return stripContractMultiplier(symbol).replace(/-USDT$/, "");
  const base = nc[1].replace(/(?:2USD|USDT)$/, "");
  return NC_COIN_ALIAS[base] ?? base;
}

/**
 * 榜单、卡片、推送上这一行该写什么名字。
 *
 * 加密维持原样（`symbol` 去掉 -USDT）：`1000PEPE-USDT` 显示成 **1000PEPE**
 * 而不是 PEPE，因为合约乘数是要看见的——卡片上那个价格就是 1000 倍的合约价，
 * 标成 PEPE 会让人按现货价读它。
 *
 * 代币化标的用 `coin`：`NCSKAAPL2USD-USDT` 显示成 **AAPL**。去掉 -USDT
 * 只会得到 `NCSKAAPL2USD` 这种没人读得懂的东西，而那正是加了这两栏之后
 * 卡片与 Telegram 推送上会出现的字样。
 *
 * 传 `coin` 而不是在这里重算一遍，是因为它已经过了别名表
 * （GOLD→XAU、QNT→QNTX 等）——重算等于把那张表再维护一份。
 */
export function displayName(symbol: string, coin: string): string {
  return assetClassOf(symbol) === "crypto" ? symbol.replace(/-USDT$/, "") : coin;
}

/**
 * 两边报价允许差多少才仍然算「同一个标的」，%。
 *
 * **这个阈值刻意定得很松。** 它要识别的是代号撞车——两个完全不同的标的
 * 共用一个代号，价格通常差一个数量级（实测 `NCSKCVX` 雪佛龙 $212.11
 * vs CoinGlass `CVX` Convex Finance $2.127，偏离 99%）。它**不是**在校验
 * 报价新鲜度：参考价来自成交量缓存，最旧可能是半小时前的，而半小时里
 * 一个标的涨跌 10% 完全正常。
 *
 * 定得紧一点能多抓到「价格恰好接近的撞名」，但代价是把真实行情波动误判成
 * 撞名、无故删行——而删行是静默的，读者看到的只是这个标的今天没出现。
 * 宁可漏掉一个巧合，不要误杀一行。
 */
export const PRICE_SANITY_MAX_DEV = 25;

/**
 * BingX 的这个合约和 CoinGlass 的那个币名，是不是同一个标的。
 *
 * 参考价缺失（还没轮转刷到、或上游没给价）时返回 true——**缺证据不等于
 * 有问题**。这跟成交量那道门刻意相反：那是流动性门槛，「证明不了达标」
 * 就该当不达标；这是错配探测，「没探测过」当成「探测到了」会无故删行。
 *
 * 只对代币化标的生效，调用方负责（见 buildScanTargets）。加密不能用这条：
 * `1000PEPE-USDT` 在 BingX 的报价是 CoinGlass `PEPE` 的一千倍，
 * 合约乘数会让每一个带乘数的币都被误判成撞名。
 */
export function sameInstrument(bingxPrice: number, referencePrice: number | null): boolean {
  if (referencePrice === null || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return true;
  }
  if (!Number.isFinite(bingxPrice) || bingxPrice <= 0) return true;
  const dev = (Math.abs(bingxPrice - referencePrice) / referencePrice) * 100;
  return dev <= PRICE_SANITY_MAX_DEV;
}

export interface PreselectCandidate {
  bingxSymbol: string;
  coin: string;
  assetClass: AssetClass;
  /** 代币化标的没有市值（CoinGlass 期货接口对它们一律返回 0），统一写 0 */
  marketCap: number;
  marketCapRank: number;
}

/**
 * 批量层的粗筛：只用 BingX ticker + CoinGecko 市值，一次额外的上游调用都不花。
 *
 * 成交额**不在这里筛** —— BingX 长尾的 quoteVolume 是被拍平的假数据
 * （516 个永续里有 144 个全挤在 619–691 万这个 0.73M 宽的带里），
 * 拿它筛成交额等于用假数据决定谁进池子。成交额筛选放到行情层，
 * 用 CoinGlass 的 volume_usd 做，这正是明细层要拆成两段的原因。
 *
 * 查不到市值一律排除：下限是一个「必须证明达标」的条件，
 * 在 CoinGecko 前 1000 名里查不到就无法证明市值 ≥ 3000万，只能当不达标处理。
 *
 * **市值这道门只对加密生效。** 代币化的商品与股票没有可比的「市值」：
 * CoinGlass 的期货接口对它们一律返回 0（实测 `/currencies/NVDA` 的
 * Market Cap 显示 $0），而 CoinGecko 那份按币名索引的表里更不可能有黄金。
 * 硬套这条门只有两种结果，都是错的：要么全部被「查不到市值」排除，
 * 要么拿 CoinGecko 上同名的**加密货币**的市值去冒充（NVDA / META / HOOD /
 * SPY 等 15 个代号在 CoinGecko 前 1000 名里都真的有同名币）。
 *
 * 它们的流动性门槛完全由成交额那一条撑着（`SERVER_GATE.minVolumeUsd`，
 * 在 buildScanTargets 里读缓存执行），那一条对三类标的一视同仁。
 */
export function preselect(
  tickers: BingXTicker[],
  marketCapMap: MarketCapMap
): PreselectCandidate[] {
  const seen = new Set<string>();
  const out: PreselectCandidate[] = [];

  for (const t of tickers) {
    if (!t.symbol.endsWith("-USDT")) continue;
    if (seen.has(t.symbol)) continue;

    const assetClass = assetClassOf(t.symbol);
    if (assetClass === null) continue; // 外汇：不在需求里

    let marketCap = 0;
    let marketCapRank = 0;
    if (assetClass === "crypto") {
      const entry = marketCapMap[stripContractMultiplier(t.symbol)];
      if (entry === undefined) continue;
      // 候选池**没有市值上限**。这里曾经有一条「排名前 50 的主流大币直接排除」，
      // 已按要求去掉：BTC/ETH/SOL 这类币只要满足市值下限与成交量门槛就能进。
      if (entry.marketCap < SERVER_GATE.minMarketCap) continue;
      marketCap = entry.marketCap;
      marketCapRank = entry.rank;
    }

    seen.add(t.symbol);
    out.push({
      bingxSymbol: t.symbol,
      coin: coinFromBingXSymbol(t.symbol),
      assetClass,
      marketCap,
      marketCapRank,
    });
  }

  // 排序只是为了让候选池顺序稳定（BingX 返回数组的顺序会抖动），便于比对与排查
  return out.sort((a, b) => a.bingxSymbol.localeCompare(b.bingxSymbol));
}

/**
 * BingX ticker 的 24h 高低算出的振幅，%。与上面 preselect 内联判断
 * `minAmplitude` 用的是同一套公式——粗筛只需要知道「达不达标」，
 * T24 之后它是**选币的唯一排序依据**（pipeline.ts 的 buildScanTargets），
 * 不再只是一个门槛判断，所以要单独导出具体数值。
 *
 * 输入非法时返回 0 而不是抛错或 null：0 会被排到振幅排名的最底部，
 * 是合理的保守值——不会像 Infinity 那样让一个数据有问题的币直接
 * 抢占榜首。
 */
export function amplitudeFromTicker(t: BingXTicker): number {
  const high = parseFloat(t.highPrice);
  const low = parseFloat(t.lowPrice);
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return 0;
  return ((high - low) / low) * 100;
}
