import { stripContractMultiplier, TOP_MARKET_CAP_EXCLUDED } from "@/lib/market-cap";
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
   * **刻意没有上限。** 早期版本有一条 5 亿的上限，用来把这个产品钉在
   * 「小市值币扫描器」这个定位上；现在去掉了，大市值币只要不在
   * CoinGecko 前 50 名（见下面 TOP_MARKET_CAP_EXCLUDED）就能进候选池。
   * 所以实际的上界是「不是主流大币」，而不是一个具体的市值数字。
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
 * BingX 在永续里混了一批代币化的股票/商品/指数/外汇（NCSK=股票、NCCO=商品、
 * NCSI=指数、NCFX=外汇），它们不是加密货币，不该出现在小市值币筛选器里。
 * 用四个明确前缀而不是裸 "NC"，避免误伤 NCASH 这类真实币种。
 */
export function isSyntheticProduct(symbol: string): boolean {
  return /^NC(SK|CO|SI|FX)/.test(symbol);
}

/**
 * BingX 永续 symbol → CoinGlass 币种名。
 * 两处差异都要抹平：-USDT 后缀，以及 1000PEPE 这种合约乘数前缀
 * （CoinGlass 那边叫 PEPE，对不上就整个币拿不到任何明细数据）。
 */
export function coinFromBingXSymbol(symbol: string): string {
  return stripContractMultiplier(symbol).replace(/-USDT$/, "");
}

export interface PreselectCandidate {
  bingxSymbol: string;
  coin: string;
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
 */
export function preselect(
  tickers: BingXTicker[],
  marketCapMap: MarketCapMap
): PreselectCandidate[] {
  const seen = new Set<string>();
  const out: PreselectCandidate[] = [];

  for (const t of tickers) {
    if (!t.symbol.endsWith("-USDT")) continue;
    if (isSyntheticProduct(t.symbol)) continue;
    if (seen.has(t.symbol)) continue;

    const entry = marketCapMap[stripContractMultiplier(t.symbol)];
    if (entry === undefined) continue;
    // 大市值币只由「前 50 名」这一条挡，没有具体的市值上限——
    // 见 SERVER_GATE.minMarketCap 的注释。
    if (entry.rank <= TOP_MARKET_CAP_EXCLUDED) continue;
    if (entry.marketCap < SERVER_GATE.minMarketCap) continue;

    seen.add(t.symbol);
    out.push({
      bingxSymbol: t.symbol,
      coin: coinFromBingXSymbol(t.symbol),
      marketCap: entry.marketCap,
      marketCapRank: entry.rank,
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
