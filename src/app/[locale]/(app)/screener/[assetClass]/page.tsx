"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScannerTable } from "@/components/screener/ScannerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { SectionHeading } from "@/components/ui/Section";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "@/lib/screener/filter";
import type { FilterState, SortKey } from "@/lib/screener/filter";
import { isLaneKey, rowsInLane } from "@/lib/screener/lanes";
import { CLASS_TABLE_TAKE } from "@/lib/screener/types";
import type { ScannerRow } from "@/lib/screener/types";

const FILTER_STORAGE_KEY = "chart-ix:scanner-filters";
const SORTABLE: SortKey[] = ["symbol", "direction", "total", "volumeUsd", "change24h", "marketCap"];

/**
 * 主扫描表的一栏。三条路由共用这一个组件：
 * `/screener/crypto`、`/screener/commodity`、`/screener/stock`。
 *
 * **为什么一栏一个页面，而不是一页三段。** 上一版是三段堆在同一页往下滚，
 * 读起来是「一份很长的榜单」，而三栏的分数与压缩度根本不可比——压缩度是
 * 无量纲比值，三类标的的振幅量级差着数倍（实测全池：加密中位 6.17%、
 * 代币化股票 1.70%）。摆在同一个滚动流里，读者会不自觉地横跨栏去比大小。
 * 各占一条路由之后，一次只看一把尺子，而且分类是可分享、可回退的地址。
 *
 * 抬头、表盘、两级 tab 都在 layout.tsx 里；数据只取一次
 * （react-query 按 queryKey 去重），六个子页共用同一份 payload。
 *
 * 排序与方向过滤是**全局**的（存在同一个 localStorage 键）：它们回答的是
 * 「我想按什么看」，跟当前在哪一栏无关，切栏时不该被重置。
 */
export default function ScreenerLanePage() {
  const t = useTranslations("screener");
  const params = useParams<{ assetClass: string }>();
  const lane = params.assetClass;
  // 路由段是用户能随手改的。`/screener/foo` 必须 404，而不是渲染一张空表
  // ——空表看起来跟「这一栏这一轮没有达标的标的」一模一样。
  if (!isLaneKey(lane)) notFound();

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
    () => sortRows(applyFilters(rowsInLane(rows, lane), filters), sort.key, sort.dir),
    [rows, lane, filters, sort]
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
          title={t(`lanes.${lane}.title`)}
          count={isLoading ? null : String(visible.length)}
          action={
            <span className="hidden text-xs text-text-muted md:inline">{t(`lanes.${lane}.hint`)}</span>
          }
        />
        <div className="mt-8">
          {!isLoading && visible.length === 0 ? (
            <p className="py-6 text-sm text-text-muted">{t("lanes.empty")}</p>
          ) : (
            <ScannerTable
              rows={visible}
              isLoading={isLoading}
              sort={sort}
              onSortChange={handleSort}
              onSelect={handleSelectRow}
              selectedSymbol={selected}
              // 骨架行数跟这一栏的名额对齐，数据到位时整页不跳
              skeletonRows={CLASS_TABLE_TAKE[lane]}
            />
          )}
        </div>
      </section>
    </>
  );
}
