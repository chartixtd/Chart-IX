"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScannerTable } from "@/components/screener/ScannerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { SectionHeading } from "@/components/ui/Section";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "@/lib/screener/filter";
import type { FilterState, SortKey } from "@/lib/screener/filter";
import { CLASS_TABLE_TAKE } from "@/lib/screener/types";
import type { ScannerRow } from "@/lib/screener/types";
import type { AssetClass } from "@/lib/screener/universe";

const FILTER_STORAGE_KEY = "chart-ix:scanner-filters";
const SORTABLE: SortKey[] = ["symbol", "direction", "total", "volumeUsd", "change24h", "marketCap"];

/** 三栏的呈现顺序。写死，不按行数排——栏的位置跟着数据动，读者每次都要重找。 */
const LANE_ORDER = ["crypto", "commodity", "stock"] as const;

/**
 * 加载态每栏画几行骨架。数字跟服务端各栏的名额（CLASS_TABLE_TAKE）对齐，
 * 这样数据到位时整页不跳——三栏都画 10 行会让加载态比真实态长一大截，
 * 大宗商品那一栏尤其明显（它常态只有四五行）。
 */
const LANE_SKELETON: Record<(typeof LANE_ORDER)[number], number> = {
  crypto: CLASS_TABLE_TAKE.crypto,
  commodity: CLASS_TABLE_TAKE.commodity,
  stock: CLASS_TABLE_TAKE.stock,
};

/**
 * 主扫描表子页。抬头、表盘、子页切换都在 layout.tsx 里，这里只管
 * 「这一轮扫出来的标的」这一件事。
 *
 * 构图：先一条发丝线门槛带（选币口径 + 方向切换），然后**三个分栏**依次
 * 落下，每栏一个展示级区块标题 + 一张表，不套圆角边框盒子。表格的结构由
 * 表头那条金色发丝线和行间线承担，外面再画一个框只是在框一个框。
 *
 * **为什么是三张表而不是一张带分类列的表。** 压缩度（选币的排序键）是无量纲
 * 比值，而三类标的的振幅量级差着数倍——实测全池 913 个标的，加密振幅中位
 * 6.17%、代币化股票 1.70%。混在一张表里排序，美股休市那几十个小时会整片压到
 * 榜首（实测周日前 20 名里 14 个是代币化股票，前三名 6h 振幅精确等于 0.00）。
 * 服务端已经按分栏各排各的名（CLASS_TABLE_TAKE），前端照着分栏呈现，
 * 读者才不会把三把不同的尺子当成一把。
 *
 * 排序与方向过滤仍然是**全局**的：换排序键会同时作用于三栏。它们回答的是
 * 「我想按什么看」，跟标的属于哪一类无关。
 *
 * 卡片那一页**不分类**——它回答的是「现在有哪些活着的信号」，标的是币还是
 * 黄金不改变这个问题。
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

  // 按分栏切开。顺序写死成加密 → 大宗商品 → 美股代币，不按行数排——
  // 栏的位置跟着数据动会让读者每次都要重新找自己要看的那一栏。
  const lanes = useMemo(() => {
    const by = new Map<AssetClass, ScannerRow[]>();
    for (const r of visible) {
      const list = by.get(r.assetClass);
      if (list) list.push(r);
      else by.set(r.assetClass, [r]);
    }
    return LANE_ORDER.map((key) => ({ key, rows: by.get(key) ?? [] }));
  }, [visible]);

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

      {lanes.map((lane, i) => (
        <section key={lane.key} className={i === 0 ? "mt-14 lg:mt-20" : "mt-16 lg:mt-24"}>
          <SectionHeading
            title={t(`lanes.${lane.key}.title`)}
            count={isLoading ? null : String(lane.rows.length)}
            action={
              <span className="hidden text-xs text-text-muted md:inline">
                {t(`lanes.${lane.key}.hint`)}
              </span>
            }
          />
          <div className="mt-8">
            {/* 加载中三栏都各自出骨架；加载完某一栏为空时只在那一栏里说一句，
                不把整页判成空——另外两栏很可能是满的。 */}
            {!isLoading && lane.rows.length === 0 ? (
              <p className="py-6 text-sm text-text-muted">{t("lanes.empty")}</p>
            ) : (
              <ScannerTable
                rows={lane.rows}
                isLoading={isLoading}
                sort={sort}
                onSortChange={handleSort}
                onSelect={handleSelectRow}
                selectedSymbol={selected}
                skeletonRows={LANE_SKELETON[lane.key]}
              />
            )}
          </div>
        </section>
      ))}
    </>
  );
}
