"use client";

import { useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { coinFromBingXSymbol } from "@/lib/screener/universe";
import {
  externalSeriesTtlMs,
  isExternalIntervalSupported,
  type ExternalFlowBar,
  type ExternalKind,
  type ExternalOhlcBar,
  type ExternalSeriesPayload,
} from "@/lib/chart/external-series";

export type ExternalSeriesStatus = "idle" | "unsupported" | "loading" | "error" | "ok";

export interface UseExternalSeriesResult {
  /**
   * 已拉到的原始序列（尚未对齐）。引用只在某个 kind 的数据真的变了时才变，
   * KlineChart 用它的 identity 判断要不要走全量重绘路径。
   */
  payload: ExternalSeriesPayload;
  /** 每个 kind 的状态，图例用它显示「周期不支持 / 加载中 / 不可用」。 */
  status: Partial<Record<ExternalKind, ExternalSeriesStatus>>;
  /** 当前周期 CoinGlass 不提供（<30m）。 */
  unsupportedInterval: boolean;
}

async function fetchSeries(kind: ExternalKind, coin: string, interval: string) {
  const url = new URL("/api/coinglass/series", window.location.origin);
  url.searchParams.set("kind", kind);
  url.searchParams.set("coin", coin);
  url.searchParams.set("interval", interval);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data.bars as ExternalOhlcBar[] | ExternalFlowBar[];
}

/**
 * 按图表上已应用的 CoinGlass 指标所声明的 kinds 拉对应序列。
 *
 * - 没有指标声明 → 一个请求都不发。
 * - 周期 <30m → 不发请求，返回 unsupportedInterval 让图例提示。
 * - 轮询/保鲜周期与服务端缓存 TTL 同一个常量（externalSeriesTtlMs），
 *   客户端不会比服务端缓存更勤地去敲它。
 * - 刻意**不**用 keepPreviousData：切币时 OI/CVD 必须立刻清空，不能把
 *   上一个币的持仓量画在新币的 K 线下面。
 */
export function useExternalSeries(
  symbol: string,
  interval: string,
  kinds: readonly ExternalKind[],
  enabled: boolean
): UseExternalSeriesResult {
  const coin = coinFromBingXSymbol(symbol);
  const supported = isExternalIntervalSupported(interval);
  const ttl = externalSeriesTtlMs(interval);
  const active = enabled && supported && kinds.length > 0;

  const results = useQueries({
    queries: kinds.map((kind) => ({
      queryKey: ["coinglass", "series", kind, coin, interval] as const,
      queryFn: () => fetchSeries(kind, coin, interval),
      enabled: active,
      staleTime: ttl,
      refetchInterval: active ? ttl : false,
      retry: 1,
    })),
  });

  // 只在某个 kind 的 data 引用变化时才换新对象——useQueries 每次渲染都返回
  // 新数组，直接拿它拼对象会让 payload 每帧都是新引用，KlineChart 就会
  // 每次轮询都走全量重绘。kinds 的长度会随指标增删而变，不能用 useMemo
  // 的依赖数组（长度变化会触发 React 警告），改用签名比较。
  const prevRef = useRef<{ sig: string; payload: ExternalSeriesPayload }>({ sig: "", payload: {} });
  const sig = kinds.map((kind, i) => `${kind}:${idOf(results[i]?.data)}`).join("|");
  let payload = prevRef.current.payload;
  if (sig !== prevRef.current.sig) {
    const next: ExternalSeriesPayload = {};
    kinds.forEach((kind, i) => {
      const d = results[i]?.data;
      if (!d) return;
      if (kind === "oi") next.oi = d as ExternalOhlcBar[];
      else next.cvd = d as ExternalFlowBar[];
    });
    prevRef.current = { sig, payload: next };
    payload = next;
  }

  const status: Partial<Record<ExternalKind, ExternalSeriesStatus>> = {};
  kinds.forEach((kind, i) => {
    const r = results[i];
    status[kind] = !enabled
      ? "idle"
      : !supported
        ? "unsupported"
        : r.data
          ? "ok"
          : r.isError
            ? "error"
            : "loading";
  });

  return { payload, status, unsupportedInterval: kinds.length > 0 && !supported };
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
