"use client";

import { useQuery } from "@tanstack/react-query";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import type { ScannerPayload } from "@/lib/screener/types";
import { SCANNER_QUERY_KEY, fetchScannerPayload } from "./useScreenerData";

/**
 * 手机底栏「选币」那一格上的角标：现在有几个活着的信号。
 *
 * 判据与扫描器页抬头那个巨型数字**必须**是同一句话（`screener/layout.tsx`
 * 里的 `liveCount`）：只数没过期的卡。灰掉的已结束卡是留给用户对照推送的
 * 上下文，不是信号——把它们算进去，底栏写着 5 而页面上只剩两张亮卡。
 *
 * 共用 `SCANNER_QUERY_KEY`，所以在扫描器页上不会多发一次请求；在别的页面上
 * 它每 15 分钟拉一次 `/api/screener`。那个接口带 `s-maxage=60` 的公共缓存 +
 * 服务端 TTL，所以这一次请求是读缓存，不会触发一次真实扫描。
 *
 * `enabled` 由调用方给：未登录（底栏上压根没有「选币」）与桌面（底栏是
 * `lg:hidden`，但组件仍然挂载）都不该拉。
 */
export function useLiveSignalCount(enabled: boolean): number | null {
  const query = useQuery<ScannerPayload, Error, number>({
    queryKey: SCANNER_QUERY_KEY,
    queryFn: fetchScannerPayload,
    enabled,
    refetchInterval: SCAN_INTERVAL_MS,
    staleTime: SCAN_INTERVAL_MS / 2,
    // 底栏不关心行情表，只关心「几个」——select 之后这个组件只在数字
    // 真的变了的时候重渲染，扫描结果每 15 分钟换一次不会带着它一起跳。
    select: (data) => data.cards.filter((card) => !card.expired).length,
    // 底栏挂在每一页上。切回前台就重拉一次，对一个角标来说是白花的流量。
    refetchOnWindowFocus: false,
  });

  // null = 还没拿到过结果。角标在这之前不出现，不闪一个 0
  return query.data ?? null;
}
