import { coinglassGet } from "./client";
import { toFiniteNumber } from "./types";
import type { CoinGlassCvdBar, CoinGlassOiBar } from "./types";
import { CVD_EXCHANGES } from "./taker-volume";
import {
  externalSeriesLimit,
  type ExternalSeriesBars,
  type ExternalSeriesRequest,
  type ExternalOhlcBar,
} from "@/lib/chart/external-series";

/**
 * 图表用的 CoinGlass 序列：把一个 request（见 external-series.ts）映射到
 * 具体端点与参数、按图表周期拉、归一化成前端能直接对齐到 K 线的紧凑行
 * （时间戳转成秒）。
 *
 * 端点一览（docs.coinglass.com，2026-08-23 核对；STARTUP 全部 ≥30m 可用）：
 *   oi  margin=all         /api/futures/open-interest/aggregated-history            无 exchange_list
 *   oi  margin=stablecoin  /api/futures/open-interest/aggregated-stablecoin-margin-history  exchange_list 必填
 *   oi  margin=coin        /api/futures/open-interest/aggregated-coin-margin-history        exchange_list 必填
 *   cvd market=futures     /api/futures/aggregated-cvd/history                             exchange_list 必填
 *   cvd market=spot        /api/spot/aggregated-cvd/history                                exchange_list 必填
 * 全部支持 unit=usd|coin、start_time/end_time；**limit 上限两族不同**：
 * open-interest 那三个 ≤1000，aggregated-cvd 那两个 ≤4500（见 externalSeriesLimit）。
 *
 * CVD 用 aggregated-cvd 而不是 aggregated-taker-buy-sell-volume，是因为前者直接返回
 * `cum_vol_delta`——**CoinGlass 自己算好的累计值**。用后者的话只能拿到逐根买卖量，
 * 前端从窗口第一根起从 0 累加，绝对值取决于我们拉了多长的窗口，和 CoinGlass 图上的
 * 读数系统性对不上（实测同一时刻我们 13.5B、它们 10.24B）。锚点必须来自上游。
 *
 * 只在服务端跑：这里 import 了 `client.ts`。
 */

/**
 * 「No Filter」时各端点用的交易所组合。合约 CVD 对齐选币器/CoinGlass 网页版
 * 默认的四家；其余按各市场上真有对应合约/现货的主流所来定。名字必须与
 * CoinGlass 的拼写一致（大小写敏感）。
 */
export const DEFAULT_EXCHANGES = {
  cvdFutures: [...CVD_EXCHANGES] as string[],
  cvdSpot: ["Binance", "OKX", "Bybit", "Coinbase", "Bitget"],
  oiStablecoin: ["Binance", "OKX", "Bybit", "Bitget", "Gate", "HTX"],
  oiCoin: ["Binance", "OKX", "Bybit", "Bitget", "Gate", "HTX", "Bitmex"],
} as const;

export interface UpstreamCall {
  path: string;
  params: Record<string, string | number>;
}

/** 纯映射，方便测试：request → CoinGlass 端点 + 查询参数。 */
export function externalRequestToUpstream(r: ExternalSeriesRequest): UpstreamCall {
  const base: Record<string, string | number> = {
    symbol: r.coin,
    interval: r.interval,
    limit: externalSeriesLimit(r.kind),
    unit: r.unit,
  };

  if (r.kind === "oi") {
    if (r.margin === "all") {
      return { path: "/api/futures/open-interest/aggregated-history", params: base };
    }
    const path =
      r.margin === "coin"
        ? "/api/futures/open-interest/aggregated-coin-margin-history"
        : "/api/futures/open-interest/aggregated-stablecoin-margin-history";
    const fallback = r.margin === "coin" ? DEFAULT_EXCHANGES.oiCoin : DEFAULT_EXCHANGES.oiStablecoin;
    return { path, params: { ...base, exchange_list: (r.exchanges ?? fallback).join(",") } };
  }

  const spot = r.market === "spot";
  return {
    path: spot ? "/api/spot/aggregated-cvd/history" : "/api/futures/aggregated-cvd/history",
    params: {
      ...base,
      exchange_list: (r.exchanges ?? (spot ? DEFAULT_EXCHANGES.cvdSpot : DEFAULT_EXCHANGES.cvdFutures)).join(","),
    },
  };
}

/**
 * CoinGlass 的 `time` 是毫秒；个别根会把数字字段给成字符串（见 types.ts
 * 里 CoinGlassOiBar 的注释），所以一律过 toFiniteNumber，坏根直接丢掉。
 * 输出按时间升序、同一时刻只留最后一根——对齐时用 Map 查，重复根只会
 * 让先来的被覆盖，先在这里钉死顺序让行为可预测。
 */
export function normalizeOiBars(raw: CoinGlassOiBar[]): ExternalOhlcBar[] {
  const out: ExternalOhlcBar[] = [];
  for (const r of raw) {
    const t = Math.floor(toFiniteNumber(r.time) / 1000);
    const o = toFiniteNumber(r.open);
    const h = toFiniteNumber(r.high);
    const l = toFiniteNumber(r.low);
    const c = toFiniteNumber(r.close);
    if (![t, o, h, l, c].every(Number.isFinite) || t <= 0) continue;
    out.push({ t, o, h, l, c });
  }
  return dedupeSorted(out);
}

/**
 * CVD 序列 → 无影线蜡烛。
 *
 * close = 本根的累计值 `cum_vol_delta`；open = 上一根的累计值，直接由
 * `cum − (buy − sell)` 得出——这个恒等式对**每一根**都成立（包括窗口第一根，
 * 那根拿不到"上一根"），所以不需要为边界特殊处理，也不会因为窗口起点不同
 * 而错位。high/low 就是这两者的大小：只有逐根的净额，没有盘中高低点
 * （那要逐笔数据），所以合成出来的必然是无影线蜡烛——CoinGlass 那个
 * 「CVD Candles」指标的 OHLC 读数也满足 H=C、L=O（截图实测），同一种画法。
 */
export function normalizeCvdBars(raw: CoinGlassCvdBar[]): ExternalOhlcBar[] {
  const out: ExternalOhlcBar[] = [];
  for (const r of raw) {
    const t = Math.floor(toFiniteNumber(r.time) / 1000);
    const c = toFiniteNumber(r.cum_vol_delta);
    const buy = toFiniteNumber(r.agg_taker_buy_vol);
    const sell = toFiniteNumber(r.agg_taker_sell_vol);
    if (![t, c, buy, sell].every(Number.isFinite) || t <= 0) continue;
    const o = c - (buy - sell);
    out.push({ t, o, h: Math.max(o, c), l: Math.min(o, c), c });
  }
  return dedupeSorted(out);
}

function dedupeSorted<T extends { t: number }>(bars: T[]): T[] {
  bars.sort((a, b) => a.t - b.t);
  const out: T[] = [];
  for (const b of bars) {
    if (out.length && out[out.length - 1].t === b.t) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}

export async function fetchExternalSeries(r: ExternalSeriesRequest): Promise<ExternalSeriesBars> {
  const { path, params } = externalRequestToUpstream(r);
  const bars =
    r.kind === "oi"
      ? normalizeOiBars(await coinglassGet<CoinGlassOiBar[]>(path, params))
      : normalizeCvdBars(await coinglassGet<CoinGlassCvdBar[]>(path, params));

  // 上游给了多少根、覆盖到多早——这两个数是回答"能不能拿到更早的数据"的唯一依据。
  // 只在缓存未命中时打一行（每个组合每个 TTL 至多一次），不会刷屏。
  const first = bars.length ? new Date(bars[0].t * 1000).toISOString() : "-";
  const last = bars.length ? new Date(bars[bars.length - 1].t * 1000).toISOString() : "-";
  console.info(
    `[coinglass/series] ${r.kind}:${r.coin}:${r.interval} asked=${params.limit} got=${bars.length} ${first}..${last}`
  );
  return bars;
}
