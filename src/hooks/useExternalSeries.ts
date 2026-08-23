"use client";

import { useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  externalRequestKey,
  externalRequestToQuery,
  externalSeriesTtlMs,
  isExternalIntervalSupported,
  type ExternalSeriesBars,
  type ExternalSeriesPayload,
  type ExternalSeriesRequest,
} from "@/lib/chart/external-series";

export type ExternalSeriesStatus = "idle" | "unsupported" | "loading" | "error" | "ok";

export interface UseExternalSeriesResult {
  /**
   * 已拉到的原始序列，按 externalRequestKey 索引（尚未对齐）。对象引用只在
   * 某个 key 的数据真的变了时才变，KlineChart 用它的 identity 判断要不要
   * 走全量重绘路径。
   */
  payload: ExternalSeriesPayload;
  /** 每个 key 的状态，图例用它显示「周期不支持 / 加载中 / 不可用」。 */
  status: Record<string, ExternalSeriesStatus>;
}

async function fetchSeries(r: ExternalSeriesRequest): Promise<ExternalSeriesBars> {
  const url = new URL("/api/coinglass/series", window.location.origin);
  for (const [k, v] of Object.entries(externalRequestToQuery(r))) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data.bars as ExternalSeriesBars;
}

/**
 * 按图表上已应用的 CoinGlass 指标各自的设置拉对应序列。
 *
 * - 调用方先把每个实例的设置变成 request（buildExternalRequest），这里按
 *   externalRequestKey 去重——两个实例设置相同就只发一次。
 * - 周期 <30m 的 request 不发，状态给 "unsupported" 让图例提示。
 * - 轮询/保鲜周期与服务端缓存 TTL 同一个常量（externalSeriesTtlMs），
 *   客户端不会比服务端缓存更勤地去敲它。
 * - 刻意**不**用 keepPreviousData：切币/改设置时旧数据必须立刻清空，不能把
 *   上一个币的持仓量画在新币的 K 线下面。
 */
export function useExternalSeries(
  requests: readonly ExternalSeriesRequest[],
  enabled: boolean
): UseExternalSeriesResult {
  // 去重，保持调用方给的顺序
  const unique: { key: string; request: ExternalSeriesRequest }[] = [];
  const seen = new Set<string>();
  for (const r of requests) {
    const key = externalRequestKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ key, request: r });
  }

  const results = useQueries({
    queries: unique.map(({ key, request }) => {
      const ttl = externalSeriesTtlMs(request.interval);
      const active = enabled && isExternalIntervalSupported(request.interval);
      return {
        queryKey: ["coinglass", "series", key] as const,
        queryFn: () => fetchSeries(request),
        enabled: active,
        staleTime: ttl,
        refetchInterval: active ? ttl : false,
        retry: 1,
      };
    }),
  });

  // 只在某个 key 的 data 引用变化时才换新对象——useQueries 每次渲染都返回
  // 新数组，直接拿它拼对象会让 payload 每帧都是新引用，KlineChart 就会
  // 每次轮询都走全量重绘。请求数会随指标增删而变，不能用 useMemo 的
  // 依赖数组（长度变化会触发 React 警告），改用签名比较。
  const prevRef = useRef<{ sig: string; payload: ExternalSeriesPayload }>({ sig: "", payload: {} });
  const sig = unique.map(({ key }, i) => `${key}=${idOf(results[i]?.data)}`).join("|");
  let payload = prevRef.current.payload;
  if (sig !== prevRef.current.sig) {
    const next: ExternalSeriesPayload = {};
    unique.forEach(({ key }, i) => {
      const d = results[i]?.data;
      if (d) next[key] = d;
    });
    prevRef.current = { sig, payload: next };
    payload = next;
  }

  const status: Record<string, ExternalSeriesStatus> = {};
  unique.forEach(({ key, request }, i) => {
    const r = results[i];
    status[key] = !enabled
      ? "idle"
      : !isExternalIntervalSupported(request.interval)
        ? "unsupported"
        : r.data
          ? "ok"
          : r.isError
            ? "error"
            : "loading";
  });

  return { payload, status };
}

// 给数据引用一个稳定的 id，用来拼签名；WeakMap 不会阻止旧数据被回收。
const ids = new WeakMap<object, number>();
let nextId = 1;
function idOf(v: unknown): number {
  if (typeof v !== "object" || v === null) return 0;
  let id = ids.get(v);
  if (id === undefined) { id = nextId++; ids.set(v, id); }
  return id;
}
