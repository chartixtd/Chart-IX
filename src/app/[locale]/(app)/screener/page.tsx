"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScannerTable } from "@/components/screener/ScannerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { SectionHeading } from "@/components/ui/Section";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "@/lib/screener/filter";
import type { FilterState, SortKey } from "@/lib/screener/filter";
import type { ScannerRow } from "@/lib/screener/types";

const FILTER_STORAGE_KEY = "chart-ix:scanner-filters";
const SORTABLE: SortKey[] = ["symbol", "direction", "total", "volumeUsd", "change24h", "marketCap"];

/**
 * 主扫描表子页。抬头、表盘、子页切换都在 layout.tsx 里，这里只管
 * 「这一轮扫出来的 20 个币」这一件事。
 *
 * 构图：先一条发丝线门槛带（选币口径 + 方向切换），再一个展示级区块标题，
 * 表格直接落在标题下面——不再套一层圆角边框盒子。表格的结构由表头那条
 * 金色发丝线和行间线承担，外面再画一个框只是在框一个框。
 */
export default function ScreenerTablePage() {
  const t = useTranslations("screener");
  const { rows, isLoading } = useScannerData();

  // 初值必须是 DEFAULT_FILTERS 而不是直接读 localStorage：服务端渲染时
  // 没有 localStorage，两边初值不一致会触发 hydration 不匹配。
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "total", dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<FilterState>;
      // 只认当前还存在的键，绝不直接 spread 旧值进来。历史上这里存过
      // volume / marketCapFloor / amplitude 三个已经删掉的键，其中 amplitude
      // 尤其危险：它曾经是个过滤条件，spread 回来会让一个早已不存在的字段
      // 悄悄参与过滤（TS 不会报错，因为读的是 JSON.parse 的结果）。
      setFilters({ direction: saved.direction ?? DEFAULT_FILTERS.direction });
    } catch {
      // 存的是坏 JSON 就当没存过，不要让一条脏缓存把整页打崩
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // 隐私模式下 localStorage 会抛，方向切换照常工作、只是不记忆
    }
  }, [filters]);

  const visible = useMemo(
    () => sortRows(applyFilters(rows, filters), sort.key, sort.dir),
    [rows, filters, sort]
  );

  // handleSort 与 handleSelectRow 必须是稳定引用（useCallback），不能是内联箭头函数——
  // ScannerTable 外面包了 memo，内联箭头函数每次渲染都是新引用，会让 memo 的浅比较
  // 必然失败，等于白包。
  const handleSort = useCallback((key: string) => {
    if (!SORTABLE.includes(key as SortKey)) return;
    setSort((prev) =>
      prev.key === key ? { key: prev.key, dir: (prev.dir * -1) as 1 | -1 } : { key: key as SortKey, dir: -1 }
    );
  }, []);

  const handleSelectRow = useCallback((r: ScannerRow) => {
    setSelected(r.symbol);
  }, []);

  return (
    <>
      <ScreenerFilters value={filters} onChange={setFilters} />

      <section className="mt-14 lg:mt-20">
        <SectionHeading
          title={t("table_title")}
          count={isLoading ? null : `${visible.length}/${rows.length}`}
          action={<span className="hidden text-xs text-text-muted md:inline">{t("table_hint")}</span>}
        />
        <div className="mt-8">
          <ScannerTable
            rows={visible}
            isLoading={isLoading}
            sort={sort}
            onSortChange={handleSort}
            onSelect={handleSelectRow}
            selectedSymbol={selected}
          />
        </div>
      </section>
    </>
  );
}
