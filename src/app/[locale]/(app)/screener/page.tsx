"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScannerTable } from "@/components/screener/ScannerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { AlertRail } from "@/components/screener/AlertRail";
import { Button } from "@/components/ui/Button";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "@/lib/screener/filter";
import type { FilterState, SortKey } from "@/lib/screener/filter";

const FILTER_STORAGE_KEY = "chart-ix:scanner-filters";
const SORTABLE: SortKey[] = ["symbol", "direction", "total", "volumeUsd", "amplitude", "marketCap"];

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) });
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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => sortRows(applyFilters(rows, filters), sort.key, sort.dir),
    [rows, filters, sort]
  );

  const remaining = lastUpdated > 0 ? lastUpdated + SCAN_INTERVAL_MS - now : null;

  const handleSort = (key: string) => {
    if (!SORTABLE.includes(key as SortKey)) return;
    setSort((prev) =>
      prev.key === key ? { key: prev.key, dir: (prev.dir * -1) as 1 | -1 } : { key: key as SortKey, dir: -1 }
    );
  };

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
          {!error && remaining !== null && (
            <span className="tnum text-xs text-text-secondary">
              {t("next_scan")} {formatCountdown(remaining)}
            </span>
          )}
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
          <p>{t("guide.zone")}</p>
          <p>{t("guide.sweep")}</p>
          <p>{t("guide.oi")}</p>
          <p>{t("guide.cvd")}</p>
          <p className="rounded-sm bg-bg-tertiary px-3 py-2">{t("guide.alert")}</p>
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
                onSelect={(r) => setSelected(r.symbol)}
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
