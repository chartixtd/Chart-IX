import { getFuturesTickers } from "@/lib/bingx/market";
import { buildMarketCapMap } from "@/lib/market-cap";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";
import { runWithConcurrency } from "@/lib/coinglass/client";
import { getPairsMarkets, getFundingRateList, pickExchangeRow } from "@/lib/coinglass/market";
import { getOpenInterestExchangeList, pickAggregatedOi } from "@/lib/coinglass/open-interest";
import { getLiquidationCoinList, getLiquidationHistory } from "@/lib/coinglass/liquidation";
import { getPriceHistory } from "@/lib/coinglass/price-history";
import { getTakerVolumeHistory } from "@/lib/coinglass/taker-volume";
import type {
  CoinGlassPairMarket,
  CoinGlassFundingRow,
  CoinGlassLiquidationCoin,
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassLiquidationBar,
  CoinGlassOpenInterestRow,
} from "@/lib/coinglass/types";
import { preselect, amplitudeFromTicker } from "./universe";
import type { PreselectCandidate } from "./universe";
import { rankForDeepScan } from "./preselect-rank";
import type { RankInput } from "./preselect-rank";
import { pickDirection, amplitudeFromBars } from "./score";
import { pickFundingRate } from "./funding";
import type { ScannerRow, ScannerPayload } from "./types";
import { DEEP_SCAN_LIMIT } from "./types";

/** 用户实际下单的交易所。价格与资金费率都取这一家。 */
export const BINGX_EXCHANGE = "BingX";

/**
 * K 线 / CVD / 爆仓时序默认取哪一家。
 * Binance 深度最好、数据最干净；这个币 Binance 没有合约时由 pickExchangeRow
 * 回落到成交额最大的那家（BingX 本身也能当 history 的 exchange 参数，实测可用）。
 */
export const PREFERRED_HISTORY_EXCHANGE = "Binance";

interface MarketStage {
  candidate: PreselectCandidate;
  /** BingX 那一行，用于展示价格 */
  bingx: CoinGlassPairMarket;
  /** 拉 history 用的交易所与合约 id */
  historyExchange: string;
  historyInstrumentId: string;
  volumeUsd: number;
  change24h: number | null;
}

/**
 * 行情层：一个币一次 pairs-markets，且只对预排序选中的 `DEEP_SCAN_LIMIT`
 * 个候选调用（见 runScan 里预排序那一段的注释）。
 *
 * 这里**不再**用 volume_usd 卡门槛（T19 之前有一个 `< SERVER_GATE.minVolumeUsd`
 * 就 return null 的检查，已删掉）：现在 pairs-markets 只对选中的 15 个调用，
 * 卡这个门槛只会让某几轮不足 15 行，而不会缩小上游调用量——门槛该起的作用
 * 已经被「只选 15 个进明细层」这件事本身取代了。真实成交额仍然写进
 * `ScannerRow.volumeUsd`，交给客户端滑块做流动性过滤。
 */
function toMarketStage(
  candidate: PreselectCandidate,
  rows: CoinGlassPairMarket[] | null
): MarketStage | null {
  if (!rows || rows.length === 0) return null;

  const bingx = rows.find((r) => r.exchange_name === BINGX_EXCHANGE);
  // BingX 那一行拿不到就整个跳过：没有它就没有可下单的价格，
  // 而这个页面唯一的出口就是跳去 BingX 下单。
  if (!bingx) return null;

  const history = pickExchangeRow(rows, PREFERRED_HISTORY_EXCHANGE);
  if (!history) return null;

  // 成交额用全交易所之和，而不是单家 —— 流动性门槛问的是「这个币好不好进出」，
  // 那是全市场的属性。只用于展示与客户端滑块过滤，不再是服务端硬门槛（见上）。
  const volumeUsd = rows.reduce((a, r) => a + (Number.isFinite(r.volume_usd) ? r.volume_usd : 0), 0);

  return {
    candidate,
    bingx,
    historyExchange: history.exchange_name,
    historyInstrumentId: history.instrument_id,
    volumeUsd,
    change24h: Number.isFinite(bingx.price_change_percent_24h)
      ? bingx.price_change_percent_24h
      : null,
  };
}

/**
 * 服务端一次算出整池榜单。
 *
 * T19 之前这里是三段式：批量层（tickers/市值/资金费率，0 次 CoinGlass 调用）
 * → 行情层（对*每个粗筛候选*调 pairs-markets）→ 明细层（对*每个行情层存活的
 * 候选*调 4 个端点）。粗筛池子常有 100–150 个候选，三段式在真实 key 下
 * 一轮要打 450–800 次 CoinGlass 调用，而 `API-KEY-MAX-LIMIT: 80`——差一个
 * 数量级，dryrun 直接被 429 打回、四因子全部退化成缺数据的默认分
 * （见 client.ts 顶部 `COINGLASS_CONCURRENCY` 的注释）。
 *
 * 现在是四段式，一轮固定 77 次调用：
 *   ① 批量层（4 路，2 次 CoinGlass 调用）：BingX ticker（0 次）+ CoinGecko
 *      市值（0 次）+ `liquidation/coin-list`（1 次，全币爆仓）+
 *      `funding-rate/exchange-list`（1 次，全币资金费率）。
 *   ② 粗筛：`preselect()`，0 次调用，只用批量层已有的数据。
 *   ③ 预排序：从粗筛池子里选出 `DEEP_SCAN_LIMIT`（15）个进入明细层，
 *      0 次调用（下面详细说）。
 *   ④ 明细层（15 × 5 = 75 次调用）：只对预排序选中的 15 个依次调
 *      pairs-markets、open-interest/exchange-list、price/history、
 *      taker-buy-sell-volume/history、liquidation/history。
 *   `2 + 15 × 5 = 77`，卡在 80 以内，留 3 次余量。
 *
 * 为什么是预排序而不是直接把 15 定成粗筛门槛的一部分：粗筛用的信号
 * （市值、BingX 高低振幅）批量层就有，不花额外调用；但「这个币现在
 * 是否值得深挖」还需要爆仓异常度这个信号——liquidation/coin-list 同样
 * 是批量层已经拿到的数据，不花额外调用，所以能在明细层开始之前，
 * 用「爆仓异常度 + 振幅」各半的分数从粗筛池子里再挑一轮，把最值得
 * 打分的 15 个送进明细层，而不是任意选 15 个或者按粗筛的自然顺序截断。
 *
 * 预排序的代价（无法避免，不是疏忽）：Zone/OI/CVD 三个因子的数据只有
 * 进了明细层才能拿到，预排序阶段完全看不到，只能用爆仓与振幅这两个
 * 粗筛阶段就有的信号做代理。一个「爆仓平淡、振幅也一般，但 Zone/OI/CVD
 * 三项本来会打出高分」的币，在 80/分钟配额下就是进不了这一轮的深度扫描——
 * 这是配额约束下必然要接受的代价，下一轮扫描（15 分钟后）它仍有机会
 * 凭爆仓或振幅的变化被选中。
 *
 * 失败语义（与 spec 的降级矩阵一一对应）：
 *   · BingX ticker 失败或为空 → 抛错。没有可交易白名单，产出的榜单
 *     可能整片都是下不了单的币。
 *   · CoinGecko 市值失败或空 map → 抛错。这与旧的 6 维模型相反：那里
 *     市值只是 25% 权重的打分项，可以降级成中性分；这里市值是硬门槛，
 *     拿不到 = 门槛失效 = BTC/ETH 和查不到的合成品直接涌进小市值筛选器。
 *   · 资金费率整表失败 → 降级，fundingRate 全为 null。它在四因子模型里
 *     只是展示字段，不参与打分。
 *   · liquidation/coin-list 整表失败 → 降级，不中断。预排序退化成
 *     只按振幅排（爆仓这一半的信号对每个候选都是同一个常数，不再区分
 *     谁高谁低，实际效果等价于「爆仓百分位全给 0」，具体原理见
 *     preselect-rank.ts 里 percentileRank 的并列取平均名次注释）。
 *     它不是硬门槛，不该因为这一个批量端点挂掉就让整轮扫描失败。
 *   · 单个币的单个端点失败 → runWithConcurrency 把它写成 null，
 *     对应因子走各自的缺失分支，不牵连其他币。
 */
export async function runScan(): Promise<ScannerPayload> {
  const [tickersSettled, capSettled, fundingSettled, liquidationSettled] = await Promise.allSettled([
    getFuturesTickers(),
    fetchMarketCapRows(),
    getFundingRateList(),
    getLiquidationCoinList(),
  ]);

  if (tickersSettled.status === "rejected") {
    throw new Error(`BingX tickers unavailable: ${String(tickersSettled.reason)}`);
  }
  const tickers = tickersSettled.value;
  if (tickers.length === 0) throw new Error("BingX tickers unavailable: empty response");

  if (capSettled.status === "rejected") {
    throw new Error(`Market cap unavailable: ${String(capSettled.reason)}`);
  }
  const marketCapMap = buildMarketCapMap(capSettled.value);
  // 空 map 必须当成失败：它是真值，会让每个币都走「查不到市值」那条路被排除，
  // 结果是一份看起来正常的空榜单被 TTL 缓存原样钉住。
  if (Object.keys(marketCapMap).length === 0) {
    throw new Error("Market cap unavailable: empty map");
  }

  const fundingByCoin = new Map<string, CoinGlassFundingRow>();
  if (fundingSettled.status === "fulfilled") {
    for (const row of fundingSettled.value) fundingByCoin.set(row.symbol, row);
  } else {
    console.error("[screener] funding rate list unavailable, degrading to null", fundingSettled.reason);
  }

  const liquidationByCoin = new Map<string, CoinGlassLiquidationCoin>();
  if (liquidationSettled.status === "fulfilled") {
    for (const row of liquidationSettled.value) liquidationByCoin.set(row.symbol, row);
  } else {
    // 不抛错：预排序对拿不到的币会用 liq1h = liq24h = 0 填充，
    // 效果是退化成只按振幅排（见上面 runScan 顶部注释与
    // preselect-rank.ts 的 percentileRank 注释）。
    console.error(
      "[screener] liquidation coin-list unavailable, degrading preselect to amplitude-only",
      liquidationSettled.reason
    );
  }

  // ① 批量层粗筛
  const candidates = preselect(tickers, marketCapMap);

  // ② 预排序：从粗筛池子里选出 DEEP_SCAN_LIMIT 个进入明细层。
  // tickerBySymbol 只是为了把 preselect() 已经消费过的 ticker 重新按
  // symbol 找回来算振幅——PreselectCandidate 本身不携带这个数值
  // （粗筛只需要知道振幅达不达标，预排序才需要具体数值），非空断言
  // 是安全的：candidates 里的每个 bingxSymbol 都直接来自 tickers 数组。
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const rankInputs: RankInput[] = candidates.map((c) => {
    const liq = liquidationByCoin.get(c.coin);
    return {
      candidate: c,
      amplitude: amplitudeFromTicker(tickerBySymbol.get(c.bingxSymbol)!),
      liq1h: liq?.liquidation_usd_1h ?? 0,
      liq24h: liq?.liquidation_usd_24h ?? 0,
    };
  });
  const deepScanTargets = rankForDeepScan(rankInputs, DEEP_SCAN_LIMIT);

  // ③ 行情层：只对预排序选中的 15 个调用 pairs-markets
  const pairRows = await runWithConcurrency(
    deepScanTargets.map((c) => () => getPairsMarkets(c.coin))
  );
  const staged = deepScanTargets
    .map((c, i) => toMarketStage(c, pairRows[i]))
    .filter((s): s is MarketStage => s !== null);

  // ④ 明细层：四个端点共用同一个并发池，所以并发上限是对上游的真实总上限。
  // staged 现在最多 15 个，入队顺序与下面取结果的 base + 0..3 下标算术
  // 保持原样不动（评审逐个验算过的对齐关系，见下方注释）。
  const detailTasks: Array<() => Promise<unknown>> = [];
  for (const s of staged) {
    detailTasks.push(() => getOpenInterestExchangeList(s.candidate.coin));
    detailTasks.push(() => getPriceHistory(s.historyExchange, s.historyInstrumentId));
    detailTasks.push(() => getTakerVolumeHistory(s.historyExchange, s.historyInstrumentId));
    detailTasks.push(() => getLiquidationHistory(s.historyExchange, s.historyInstrumentId));
  }
  const detail = await runWithConcurrency(detailTasks);

  const rows: ScannerRow[] = [];
  for (let i = 0; i < staged.length; i++) {
    const s = staged[i];
    const base = i * 4;
    const oiRows = detail[base] as CoinGlassOpenInterestRow[] | null;
    const priceBars = (detail[base + 1] as CoinGlassPriceBar[] | null) ?? [];
    const taker = (detail[base + 2] as CoinGlassTakerBar[] | null) ?? [];
    const liquidation = (detail[base + 3] as CoinGlassLiquidationBar[] | null) ?? [];

    const price = s.bingx.current_price;
    if (!Number.isFinite(price) || price <= 0) continue;

    const { direction, total, factors } = pickDirection({
      price,
      priceBars,
      taker,
      liquidation,
      openInterest: oiRows ? pickAggregatedOi(oiRows) : undefined,
    });

    rows.push({
      symbol: s.candidate.bingxSymbol,
      coin: s.candidate.coin,
      direction,
      total,
      factors,
      price,
      change24h: s.change24h,
      // K 线拿不到时退回 0：振幅只用于展示与客户端滑块过滤，
      // 0 会被任何滑块挡住，这正是「数据不全就别推荐」的正确行为。
      amplitude: amplitudeFromBars(priceBars) ?? 0,
      volumeUsd: s.volumeUsd,
      marketCap: s.candidate.marketCap,
      marketCapRank: s.candidate.marketCapRank,
      fundingRate: pickFundingRate(fundingByCoin.get(s.candidate.coin), BINGX_EXCHANGE),
      sourceExchange: s.historyExchange,
    });
  }

  rows.sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));

  return { rows, computedAt: Date.now() };
}
