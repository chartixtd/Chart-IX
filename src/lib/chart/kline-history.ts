import type { BingXKline } from "@/types/bingx";

/**
 * 合并两批K线为一个按 openTime 升序、去重后的数组。既用于"把翻页拉到的更早
 * 一批拼到已加载数据前面"，也用于"把累积的历史页和最新页轮询结果合并成给图
 * 表用的完整数组"——两种场景本质是同一个操作：两批可能有重叠的数据合成一批。
 */
export function mergeOlderKlines(a: BingXKline[], b: BingXKline[]): BingXKline[] {
  const byOpenTime = new Map<number, BingXKline>();
  for (const k of a) byOpenTime.set(k.openTime, k);
  for (const k of b) byOpenTime.set(k.openTime, k);
  return Array.from(byOpenTime.values()).sort((x, y) => x.openTime - y.openTime);
}

/**
 * BingX 的K线接口单次最多返回 `limit` 根。翻页请求如果返回数量少于请求的
 * limit（含 0），说明再往前已经没有数据了——这是唯一可用的信号，两个接口都
 * 不会告诉你某个交易对的上市时间。
 */
export function determineHasMore(receivedCount: number, requestedLimit: number): boolean {
  return receivedCount > 0 && receivedCount >= requestedLimit;
}

/**
 * 下一页翻页请求要用的 endTime：当前已加载最早一根K线的 openTime 往前推
 * 1 毫秒，避免因为 BingX 的 endTime 是闭区间而重复拉到边界那一根。
 */
export function computeNextEndTime(earliestOpenTimeMs: number): number {
  return earliestOpenTimeMs - 1;
}
