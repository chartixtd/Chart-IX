import type { ScannerRow } from "./types";

export type DirectionFilter = "all" | "long" | "short";

export interface FilterState {
  direction: DirectionFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  direction: "all",
};

export type SortKey = "symbol" | "direction" | "total" | "volumeUsd" | "change24h" | "marketCap";

/**
 * 纯客户端过滤。服务端已经对整池算好分，这里只决定哪些行显示——
 * 切换方向不会改变任何币的分数，也不会改变警报触发。
 *
 * 成交量、市值、振幅**都不在这里过滤**：三者全部由服务端执行完了，
 * 能到前端的行必然已经达标。
 *
 * 振幅这一维 T24 删掉：它曾经是个滑块（1.5–3%），而选币改成「按振幅排名
 * 取前 AMPLITUDE_RANK_TAKE 个」之后，能进榜的行振幅实测都在 14% 以上，
 * 滑块拉到头也筛不掉任何一行——一个可证明无效的控件比没有更糟，
 * 它在暗示用户「我调了一下，结果变了」，而实际什么都没发生。
 */
export function applyFilters(rows: ScannerRow[], f: FilterState): ScannerRow[] {
  return rows.filter((r) => f.direction === "all" || r.direction === f.direction);
}

/** 返回新数组 —— react 的列表渲染依赖引用变化，原地排序会让表格不更新。 */
export function sortRows(rows: ScannerRow[], key: SortKey, dir: 1 | -1): ScannerRow[] {
  return [...rows].sort((a, b) => {
    // 数据不全的行永远沉底，**不受当前排序列与升降序影响**。
    // 它们的分数/方向是缺失回退值，混进任何一列的排序里都会误导：
    // 按分数降序时它们会插在中段（回退分合计 40），按升序时又会跑到最前，
    // 两种都在暗示一个它们没有的结论。
    const gapDiff = (a.dataGaps?.length ?? 0) - (b.dataGaps?.length ?? 0);
    if (gapDiff !== 0) return gapDiff;

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
