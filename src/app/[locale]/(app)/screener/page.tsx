"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScannerTable } from "@/components/screener/ScannerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { AlertRail } from "@/components/screener/AlertRail";
import { ScanCountdown } from "@/components/screener/ScanCountdown";
import { Button } from "@/components/ui/Button";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "@/lib/screener/filter";
import type { FilterState, SortKey } from "@/lib/screener/filter";
import type { ScannerRow } from "@/lib/screener/types";
import { cn } from "@/lib/utils";
import { SCENARIO_KINDS, TRAP_KINDS, scenarioTone, TONE_CLASSES } from "@/components/screener/scenario-ui";

const FILTER_STORAGE_KEY = "chart-ix:scanner-filters";
const SORTABLE: SortKey[] = ["symbol", "direction", "total", "volumeUsd", "change24h", "marketCap"];

export default function ScreenerPage() {
  const t = useTranslations("screener");
  const tCalc = useTranslations("calculator");
  const locale = useLocale();
  const { rows, alerts, isLoading, error, isRefreshing, lastUpdated, refetch } = useScannerData();

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
      // 隐私模式下 localStorage 会抛，滑块照常工作、只是不记忆
    }
  }, [filters]);

  const visible = useMemo(
    () => sortRows(applyFilters(rows, filters), sort.key, sort.dir),
    [rows, filters, sort]
  );

  // handleSort 与 handleSelectRow 必须是稳定引用（useCallback），不能是内联箭头函数——
  // ScannerTable 外面包了 memo，内联箭头函数每次渲染都是新引用，会让 memo 的浅比较
  // 必然失败，等于白包。倒计时的每秒重渲染已经被隔离进 ScanCountdown，但页面未来
  // 也可能因为别的原因重渲染，这里稳定引用是让 memo 真正生效的必要条件。
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
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-text-primary">
            {t("title")}
          </h1>
          <p className="text-[11px] tracking-wider text-text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 报错时不显示倒计时——那会是一个冻在 00:00 的假进度 */}
          {!error && <ScanCountdown lastUpdated={lastUpdated} />}
          <Button variant="ghost" size="sm" onClick={refetch} disabled={isRefreshing}>
            {t("refresh_now")}
          </Button>
        </div>
      </div>

      <Link
        href={`/${locale}/tools/position-size`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-gold"
      >
        {tCalc("title")} →
      </Link>

      <details className="mb-4 rounded-lg panel">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-text-primary">
          {t("guide.title")}
        </summary>
        <div className="space-y-2.5 border-t border-border-default px-4 py-3 text-xs leading-relaxed text-text-secondary">
          <p>{t("guide.oi")}</p>
          <p>{t("guide.cvd")}</p>
          <p className="rounded-sm bg-bg-tertiary px-3 py-2">{t("guide.alert")}</p>
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
              {t("guide.scenarios_title")}
            </p>
            <ul className="space-y-1">
              {SCENARIO_KINDS.map((kind) => (
                <li key={kind} className="flex items-baseline gap-1.5">
                  <span className={cn("font-medium", TONE_CLASSES[scenarioTone(kind)].text)}>
                    {TRAP_KINDS.has(kind) && <span aria-hidden>⚠ </span>}
                    {t(`scenarios.${kind}.name`)}
                  </span>
                  <span>— {t(`scenarios.${kind}.action`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      {error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-secondary">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <ScreenerFilters value={filters} onChange={setFilters} count={visible.length} />
            <section className="overflow-hidden rounded-lg border border-border-default bg-bg-primary">
              <div className="flex items-baseline gap-2 border-b border-border-default px-3 py-2">
                <h2 className="font-display text-sm font-semibold tracking-tight text-text-primary">
                  {t("table_title")}
                </h2>
                <span className="text-[11px] text-text-muted">{t("table_hint")}</span>
              </div>
              <ScannerTable
                rows={visible}
                isLoading={isLoading}
                sort={sort}
                onSortChange={handleSort}
                onSelect={handleSelectRow}
                selectedSymbol={selected}
              />
            </section>
          </div>
          <AlertRail alerts={alerts} />
        </div>
      )}
    </div>
  );
}
