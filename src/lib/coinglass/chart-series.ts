import { coinglassGet } from "./client";
import { toFiniteNumber } from "./types";
import type { CoinGlassOiBar, CoinGlassTakerBar } from "./types";
import { CVD_EXCHANGES } from "./taker-volume";
import {
  EXTERNAL_SERIES_LIMIT,
  type ExternalKind,
  type ExternalFlowBar,
  type ExternalOhlcBar,
} from "@/lib/chart/external-series";

/**
 * 图表用的 CoinGlass 序列：按 kind 选端点、按图表周期拉、归一化成
 * 前端能直接对齐到 K 线的紧凑行（时间戳转成秒）。
 *
 * 端点与选币器共用（`open-interest.ts` / `taker-volume.ts` 里实测过的那两个），
 * 区别只在粒度不再写死 30m，而是跟着图表周期走——白名单里的粒度每一档
 * 都是 CoinGlass 自己切好的，不需要前端重采样。
 *
 * 只在服务端跑：这里 import 了 `client.ts`。
 */

export type ExternalSeriesBars = ExternalOhlcBar[] | ExternalFlowBar[];

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

export async function fetchExternalSeries(
  kind: ExternalKind,
  coin: string,
  interval: string
): Promise<ExternalSeriesBars> {
  if (kind === "oi") {
    const raw = await coinglassGet<CoinGlassOiBar[]>(
      "/api/futures/open-interest/aggregated-history",
      { symbol: coin, interval, limit: EXTERNAL_SERIES_LIMIT }
    );
    return normalizeOiBars(raw);
  }
  const raw = await coinglassGet<CoinGlassTakerBar[]>(
    "/api/futures/aggregated-taker-buy-sell-volume/history",
    {
      symbol: coin,
      interval,
      limit: EXTERNAL_SERIES_LIMIT,
      exchange_list: CVD_EXCHANGES.join(","),
    }
  );
  return normalizeTakerBars(raw);
}
