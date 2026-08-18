"use client";

import { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";
import { formatPercent, cn } from "@/lib/utils";
import { formatCompactUsd } from "@/lib/market-cap";
import { ALERT_TRIGGER_SCORE } from "@/lib/screener/types";
import type { ScannerRow } from "@/lib/screener/types";
import type { SortKey } from "@/lib/screener/filter";
import { FactorStack } from "./FactorStack";

export const ScannerTable = memo(function ScannerTable({
  rows,
  isLoading,
  sort,
  onSortChange,
  onSelect,
  selectedSymbol,
}: {
  rows: ScannerRow[];
  isLoading: boolean;
  sort: { key: SortKey; dir: 1 | -1 };
  onSortChange: (key: string) => void;
  onSelect: (row: ScannerRow) => void;
  selectedSymbol: string | null;
}) {
  const t = useTranslations("screener");

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const columns: RecordColumn<ScannerRow>[] = [
    {
      key: "symbol",
      header: t("columns.symbol"),
      primary: true,
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="font-display text-sm font-semibold text-text-primary">{r.coin}</span>
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            {r.sourceExchange}
          </span>
        </span>
      ),
    },
    {
      key: "direction",
      header: t("columns.direction"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
            r.direction === "long" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          )}
        >
          {r.direction === "long" ? "LONG" : "SHORT"}
        </span>
      ),
    },
    {
      key: "total",
      header: t("columns.total"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "tnum text-sm font-bold",
            r.total >= ALERT_TRIGGER_SCORE ? "text-gold" : "text-text-primary"
          )}
        >
          {r.total}
        </span>
      ),
    },
    {
      key: "factors",
      header: t("columns.factors"),
      hideOnMobile: true,
      render: (r) => (
        // FactorStack 本身整个是 aria-hidden（它只是四根装饰柱），
        // 所以这里补一层文字说明，屏幕阅读器用户才能读到这四个数。
        // 警报卡不需要这个 —— 它每根柱子旁边已经有文字标签和分数。
        <span title={`Zone ${r.factors.zone} / Sweep ${r.factors.sweep} / OI ${r.factors.oi} / CVD ${r.factors.cvd}`}>
          <FactorStack factors={r.factors} />
          <span className="sr-only">
            {`Zone ${r.factors.zone} / Sweep ${r.factors.sweep} / OI ${r.factors.oi} / CVD ${r.factors.cvd}`}
          </span>
        </span>
      ),
    },
    {
      key: "volumeUsd",
      header: t("columns.volume"),
      sortable: true,
      render: (r) => (
        <span className="tnum text-sm">{(r.volumeUsd / 1_000_000).toFixed(1)}M</span>
      ),
    },
    {
      // 只显示 24h 涨跌，不再并排显示振幅。振幅仍然在数据里、也仍然是
      // 筛选滑块的过滤依据，只是不占表格宽度——两个百分数并排时读者
      // 每次都要先分辨哪个是哪个，而真正要一眼看的是涨跌方向。
      key: "change24h",
      header: t("columns.change"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "tnum text-sm",
            r.change24h === null
              ? "text-text-secondary"
              : r.change24h >= 0
                ? "text-success"
                : "text-danger"
          )}
        >
          {r.change24h === null ? "—" : formatPercent(r.change24h)}
        </span>
      ),
    },
    {
      key: "marketCap",
      header: t("columns.market_cap"),
      sortable: true,
      hideOnMobile: true,
      render: (r) => (
        <span className="tnum whitespace-nowrap text-sm">{formatCompactUsd(r.marketCap)}</span>
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      render: (r) => (
        <Link href={`/trade?symbol=${r.symbol}&side=${r.direction}&market=futures`}>
          <Button
            variant={r.direction === "long" ? "green" : "red"}
            size="sm"
            className="min-h-[44px] px-2 text-xs lg:h-6"
          >
            {r.direction === "long" ? t("action_long") : t("action_short")}
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <RecordList
      rows={rows}
      columns={columns}
      rowKey={(r) => r.symbol}
      sort={sort}
      onSortChange={onSortChange}
      onRowClick={onSelect}
      empty={t("no_results")}
      rowClassName={(r) =>
        cn(
          // 达标行用金色左边框而不是整行底色：整行染色会和 hover / selected
          // 三种状态叠在一起，最后哪个都读不出来
          r.total >= ALERT_TRIGGER_SCORE && "border-l-2 border-l-gold",
          r.symbol === selectedSymbol && "bg-bg-tertiary"
        )
      }
    />
  );
});
