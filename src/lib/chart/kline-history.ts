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

/** interval 字符串 → 单根K线时长（毫秒）。与 KlineChart 里 INTERVAL_SECONDS 同款映射。 */
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

/** 未识别的 interval 兜底成 1 小时——和 KlineChart 的 INTERVAL_SECONDS 兜底策略一致。 */
export function intervalToMs(interval: string): number {
  return INTERVAL_MS[interval] ?? 3_600_000;
}

/**
 * 两段窗口能否安全并集：旧段的最大 openTime 必须与新段的最小 openTime 相接或
 * 重叠，否则中间有真空洞（例如后台标签页停止轮询很久后窗口大幅前移），并集
 * 会产出一段断裂的序列——下游按 index 空间连续计算的指标（MA/RSI 等）会在
 * 接缝处产出静默错误的值。
 *
 * newerMinOpenTime - olderMaxOpenTime <= intervalMs 视为相接/重叠：
 * 相等（差 0）= 完全重叠，差一个 interval = 正好首尾相接，差更大 = 有空洞。
 * newer 比 older 更早（差为负，例如 newer 其实是被重新拉到的更旧一段）也视为
 * true——这种情况本身不构成"跳跃式空洞"，交给 mergeOlderKlines 的去重处理。
 */
export function windowsAreContiguous(
  olderMaxOpenTime: number,
  newerMinOpenTime: number,
  intervalMs: number
): boolean {
  return newerMinOpenTime - olderMaxOpenTime <= intervalMs;
}
