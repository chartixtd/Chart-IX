import { coinglassGet } from "./client";
import { toFiniteNumber } from "./types";
import type { CoinGlassOiBar, CoinGlassTakerBar } from "./types";
import { CVD_EXCHANGES } from "./taker-volume";
import {
  EXTERNAL_SERIES_LIMIT,
  type ExternalSeriesBars,
  type ExternalSeriesRequest,
  type ExternalFlowBar,
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
 *   cvd market=futures     /api/futures/aggregated-taker-buy-sell-volume/history           exchange_list 必填
 *   cvd market=spot        /api/spot/aggregated-taker-buy-sell-volume/history              exchange_list 必填
 * 全部支持 unit=usd|coin、limit≤1000、start_time/end_time。
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
    limit: EXTERNAL_SERIES_LIMIT,
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
    path: spot
      ? "/api/spot/aggregated-taker-buy-sell-volume/history"
      : "/api/futures/aggregated-taker-buy-sell-volume/history",
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

export function normalizeTakerBars(raw: CoinGlassTakerBar[]): ExternalFlowBar[] {
  const out: ExternalFlowBar[] = [];
  for (const r of raw) {
    const t = Math.floor(toFiniteNumber(r.time) / 1000);
    const buy = toFiniteNumber(r.aggregated_buy_volume_usd);
    const sell = toFiniteNumber(r.aggregated_sell_volume_usd);
    if (![t, buy, sell].every(Number.isFinite) || t <= 0) continue;
    out.push({ t, buy, sell });
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
  if (r.kind === "oi") {
    return normalizeOiBars(await coinglassGet<CoinGlassOiBar[]>(path, params));
  }
  return normalizeTakerBars(await coinglassGet<CoinGlassTakerBar[]>(path, params));
}
