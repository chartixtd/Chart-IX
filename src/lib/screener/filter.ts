import { CLIENT_SLIDER } from "./universe";
import type { ScannerRow } from "./types";

export type DirectionFilter = "all" | "long" | "short";

export interface FilterState {
  /** 百分比。唯一还可调的门槛，其余（成交量、市值）已固定并下沉到服务端。 */
  amplitude: number;
  direction: DirectionFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  amplitude: CLIENT_SLIDER.amplitude.default,
  direction: "all",
};

export type SortKey = "symbol" | "direction" | "total" | "volumeUsd" | "change24h" | "marketCap";

/**
 * 纯客户端过滤。服务端已经对整池算好分，这里只决定哪些行显示 ——
 * 拉动滑块不会改变任何币的分数，也不会改变警报触发。
 *
 * 成交量与市值**不在这里过滤**：它们已经是固定门槛，由服务端在粗筛
 * （市值）与行情层（成交额）执行完了，能到前端的行必然已经达标。
 * 固定门槛再放一份在客户端是双重损失——既浪费深度扫描名额，
 * 又让读者以为它可调。
 */
export function applyFilters(rows: ScannerRow[], f: FilterState): ScannerRow[] {
  return rows.filter(
    (r) => r.amplitude >= f.amplitude && (f.direction === "all" || r.direction === f.direction)
  );
}

/** 返回新数组 —— react 的列表渲染依赖引用变化，原地排序会让表格不更新。 */
export function sortRows(rows: ScannerRow[], key: SortKey, dir: 1 | -1): ScannerRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;

    // change24h 可能是 null（关联不到现货 24h 涨跌）。null 一律沉底，
    // 两个方向都是——不能靠 Number(null)=0 混进中间：那会让「没数据」
    // 冒充「涨跌为 0」，在升序时还会排到所有下跌的币前面。
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;

    return (Number(av) - Number(bv)) * dir;
  });
}
