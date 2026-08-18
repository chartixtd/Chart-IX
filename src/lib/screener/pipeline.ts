import { getFuturesTickers } from "@/lib/bingx/market";
import { buildMarketCapMap } from "@/lib/market-cap";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";
import { runWithConcurrency } from "@/lib/coinglass/client";
import { getPairsMarkets, getFundingRateList, pickExchangeRow } from "@/lib/coinglass/market";
import { getOpenInterestExchangeList, pickAggregatedOi } from "@/lib/coinglass/open-interest";
import { getLiquidationHistory } from "@/lib/coinglass/liquidation";
import { getPriceHistory } from "@/lib/coinglass/price-history";
import { getTakerVolumeHistory } from "@/lib/coinglass/taker-volume";
import type {
  CoinGlassPairMarket,
  CoinGlassFundingRow,
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassLiquidationBar,
  CoinGlassOpenInterestRow,
} from "@/lib/coinglass/types";
import { preselect, SERVER_GATE } from "./universe";
import type { PreselectCandidate } from "./universe";
import { pickDirection, amplitudeFromBars } from "./score";
import { pickFundingRate } from "./funding";
import type { ScannerRow, ScannerPayload } from "./types";

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
 * 行情层：一个币一次 pairs-markets。
 *
 * 成交额筛选放在这里而不是粗筛，因为只有 CoinGlass 的 volume_usd 是可信的
 * —— BingX 长尾的 quoteVolume 被拍平成一条 0.73M 宽的假带（516 个永续里
 * 有 144 个挤在里面）。这就是明细层必须拆成两段的全部原因。
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
  // 那是全市场的属性。
  const volumeUsd = rows.reduce((a, r) => a + (Number.isFinite(r.volume_usd) ? r.volume_usd : 0), 0);
  if (volumeUsd < SERVER_GATE.minVolumeUsd) return null;

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
 * 失败语义（与 spec 的降级矩阵一一对应）：
 *   · BingX ticker 失败或为空 → 抛错。没有可交易白名单，产出的榜单
 *     可能整片都是下不了单的币。
 *   · CoinGecko 市值失败或空 map → 抛错。这与旧的 6 维模型相反：那里
 *     市值只是 25% 权重的打分项，可以降级成中性分；这里市值是硬门槛，
 *     拿不到 = 门槛失效 = BTC/ETH 和查不到的合成品直接涌进小市值筛选器。
 *   · 资金费率整表失败 → 降级，fundingRate 全为 null。它在四因子模型里
 *     只是展示字段，不参与打分。
 *   · 单个币的单个端点失败 → runWithConcurrency 把它写成 null，
 *     对应因子走各自的缺失分支，不牵连其他币。
 */
export async function runScan(): Promise<ScannerPayload> {
  const [tickersSettled, capSettled, fundingSettled] = await Promise.allSettled([
    getFuturesTickers(),
    fetchMarketCapRows(),
    getFundingRateList(),
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

  // ① 批量层粗筛
  const candidates = preselect(tickers, marketCapMap);

  // ② 行情层
  const pairRows = await runWithConcurrency(
    candidates.map((c) => () => getPairsMarkets(c.coin))
  );
  const staged = candidates
    .map((c, i) => toMarketStage(c, pairRows[i]))
    .filter((s): s is MarketStage => s !== null);

  // ③ 明细层：四个端点共用同一个并发池，所以并发上限是对上游的真实总上限
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
