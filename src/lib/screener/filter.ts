import { CLIENT_SLIDER } from "./universe";
import type { ScannerRow } from "./types";

export type DirectionFilter = "all" | "long" | "short";

export interface FilterState {
  /** 百万美元 */
  volume: number;
  /** 百分比 */
  amplitude: number;
  /** 百万美元 */
  marketCapFloor: number;
  direction: DirectionFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  volume: CLIENT_SLIDER.volume.default,
  amplitude: CLIENT_SLIDER.amplitude.default,
  marketCapFloor: CLIENT_SLIDER.marketCapFloor.default,
  direction: "all",
};

export type SortKey = "symbol" | "direction" | "total" | "volumeUsd" | "amplitude" | "marketCap";

/**
 * 纯客户端过滤。服务端已经对整池算好分，这里只决定哪些行显示 ——
 * 拉动滑块不会改变任何币的分数，也不会改变警报触发。
 *
 * 滑块的单位是百万美元，行数据的单位是美元，比较前必须换算。
 * 这两个单位不统一是刻意的：滑块读数要给人看（"15M"），
 * 行数据要给计算用。
 */
export function applyFilters(rows: ScannerRow[], f: FilterState): ScannerRow[] {
  const minVolume = f.volume * 1_000_000;
  const minCap = f.marketCapFloor * 1_000_000;
  const maxCap = CLIENT_SLIDER.marketCapCeiling * 1_000_000;

  return rows.filter(
    (r) =>
      r.volumeUsd >= minVolume &&
      r.amplitude >= f.amplitude &&
      r.marketCap >= minCap &&
      r.marketCap <= maxCap &&
      (f.direction === "all" || r.direction === f.direction)
  );
}

/** 返回新数组 —— react 的列表渲染依赖引用变化，原地排序会让表格不更新。 */
export function sortRows(rows: ScannerRow[], key: SortKey, dir: 1 | -1): ScannerRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return (Number(av) - Number(bv)) * dir;
  });
}
