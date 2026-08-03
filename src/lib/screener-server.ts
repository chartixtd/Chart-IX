import {
  getFuturesTickers,
  getSpotTickers,
  getFuturesOpenInterest,
  getFuturesFundingRate,
} from "@/lib/bingx/market";
import { buildMarketCapMap } from "@/lib/market-cap";
import type { MarketCapMap } from "@/lib/market-cap";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";
import {
  selectCandidateSymbols,
  computeScreenerGroups,
  buildChange24hMap,
  SCREENER_REFRESH_MS,
} from "@/lib/screener-scoring";
import type { ScreenerResult } from "@/lib/screener-scoring";
import { createTtlCache } from "@/lib/ttl-cache";

export interface ScreenerPayload {
  long: ScreenerResult[];
  short: ScreenerResult[];
  /** 这份结果的计算时间，ms epoch —— 前端用它算倒计时 */
  computedAt: number;
  marketCapUnavailable: boolean;
}

/** 明细请求的并发上限。候选池实测 200-400 个币，无上限地一次性铺开会把上游打爆。 */
const DETAIL_CONCURRENCY = 8;

/**
 * 固定 limit 个 worker 轮流从任务队列里取活，而不是「切成 limit 大小的批、批间等齐」。
 * 分批会被批内最慢的那个请求拖住整批（几百个币下来累计出好几十秒的空等），
 * worker 池里谁先空出来谁就接下一个，慢请求只占住一条通道。
 * 任务自身负责吞掉异常——单个币失败不该带倒整条流水线。
 */
async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/**
 * 一次性把候选池的持仓量与资金费率取回来。两个维度共用同一个并发池，
 * 所以「上限 8」是对上游的真实总并发上限，而不是每个维度各 8。
 *
 * 逐个失败一律吞掉、只收有限值：缺失的币在打分时走中性分支
 * （见 screener-scoring 里的 oiRatioScore / fundingScore），不影响其余币的排名。
 *
 * 但两个维度各自统计成功次数：候选池非空时若某一维度整体拿到 0 个有限值
 * （比如 BingX 把 OI/资金费率这两条限流或封禁了），说明不是「个别币缺数据」
 * 而是「这个维度整体失效」——继续算下去只会产出一份看起来正常、实则 35%
 * 权重（资金费率 20% + OI 15%）全是中性噪音的榜单，还会被 TTL 缓存原样钉住一小时。
 * 抛错交给上层：有旧结果就沿用旧结果（stale-while-error），没有就让路由报 502。
 */
async function fetchDetailMaps(symbols: string[]): Promise<{
  oiMap: Record<string, number>;
  frMap: Record<string, number>;
}> {
  const oiMap: Record<string, number> = {};
  const frMap: Record<string, number> = {};
  let oiSuccessCount = 0;
  let frSuccessCount = 0;

  const tasks: Array<() => Promise<void>> = [];
  for (const symbol of symbols) {
    tasks.push(async () => {
      try {
        const value = parseFloat((await getFuturesOpenInterest(symbol)).openInterest);
        if (Number.isFinite(value)) {
          oiMap[symbol] = value;
          oiSuccessCount++;
        }
      } catch {
        // 单个币的持仓量拿不到 —— 保持 map 里没有这个 key，打分时走中性分
      }
    });
    tasks.push(async () => {
      try {
        const value = parseFloat((await getFuturesFundingRate(symbol)).lastFundingRate);
        if (Number.isFinite(value)) {
          frMap[symbol] = value;
          frSuccessCount++;
        }
      } catch {
        // 同上：资金费率缺失默认 0，fundingScore(0) 恰好是中性 50
      }
    });
  }

  await runWithConcurrency(tasks, DETAIL_CONCURRENCY);

  if (symbols.length > 0 && oiSuccessCount === 0) {
    throw new Error("Open interest unavailable for entire candidate pool");
  }
  if (symbols.length > 0 && frSuccessCount === 0) {
    throw new Error("Funding rate unavailable for entire candidate pool");
  }

  return { oiMap, frMap };
}

/**
 * 服务端一次算出两组榜单。原先这套流水线跑在每个用户的浏览器里，
 * 每人每轮约 82 次上游请求且算出的结果完全相同；搬到服务端后全站每小时算一次。
 *
 * 失败语义：**合约 ticker** 失败必抛错（没有它无法产出任何结果）；
 * 持仓量、资金费率两个维度若**整体**（候选池非空却 0 个成功）拿不到数据也抛错——
 * 见 fetchDetailMaps。除此之外，现货、市值失败，以及持仓量/资金费率的
 * 个别币缺失，都只降级、不中断流程。
 */
export async function computeScreenerPayload(): Promise<ScreenerPayload> {
  const [futuresSettled, spotSettled, marketCapSettled] = await Promise.allSettled([
    getFuturesTickers(),
    getSpotTickers(),
    fetchMarketCapRows(),
  ]);

  if (futuresSettled.status === "rejected") {
    throw new Error(`Futures tickers unavailable: ${String(futuresSettled.reason)}`);
  }
  const futuresTickers = futuresSettled.value;
  // 空数组等同于"这一路没拿到数据"：继续往下算只会产出两组空榜单，
  // 而且会被 TTL 缓存原样兜住一小时。抛错让缓存要么沿用旧结果、要么让路由报 502。
  if (futuresTickers.length === 0) {
    throw new Error("Futures tickers unavailable: empty response");
  }

  // 合约 ticker 的 priceChangePercent 只是 ~3 分钟窗口，动量维度和追高淡汰都需要
  // 现货 ticker 的真 24h 涨跌。现货这一路失败时退化成空 map —— 不是错误，
  // 所有币走中性动量分、且不做追高淡汰。
  const spotTickers = spotSettled.status === "fulfilled" ? spotSettled.value : [];
  const change24hMap = buildChange24hMap(futuresTickers, spotTickers);

  // 市值请求失败（含 hasTopRankCoverage 不通过，fetchMarketCapRows 内部会抛）时不阻塞筛选：
  // 传 null 让打分退回中性分并跳过排名排除。
  // 空 map（{}）也必须归一成 null —— 它是真值，会让每个币都走"查不到市值"
  // 那条路拿满分，等于把 BTC 当成微型盘塞进小市值筛选器。
  let marketCapMap: MarketCapMap | null = null;
  if (marketCapSettled.status === "fulfilled") {
    const built = buildMarketCapMap(marketCapSettled.value);
    if (Object.keys(built).length > 0) marketCapMap = built;
  }
  const marketCapUnavailable = marketCapMap === null;

  // 排序只是为了让候选池顺序稳定（BingX 返回数组的顺序会抖动），便于比对与排查。
  const candidateSymbols = selectCandidateSymbols(futuresTickers, marketCapMap, change24hMap).sort();

  const { oiMap, frMap } = await fetchDetailMaps(candidateSymbols);

  const groups = computeScreenerGroups(futuresTickers, oiMap, frMap, marketCapMap, change24hMap);

  return {
    long: groups.long,
    short: groups.short,
    computedAt: Date.now(),
    marketCapUnavailable,
  };
}

// 全站共用一份结果：TTL 到期前所有请求读同一份，冷缓存时并发请求只触发一次上游计算。
const screenerCache = createTtlCache<ScreenerPayload>({
  ttlMs: SCREENER_REFRESH_MS,
  compute: computeScreenerPayload,
});

export function getScreenerPayload(): Promise<ScreenerPayload> {
  return screenerCache.get();
}
