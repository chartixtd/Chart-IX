"use client";

import { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";
import { formatPrice, formatNumber, formatPercent, cn } from "@/lib/utils";
import { formatCompactUsd } from "@/lib/market-cap";
import type { ScreenerResult, Direction } from "@/lib/screener-scoring";

const COLUMN_KEYS = [
  "rank",
  "symbol",
  "price",
  "change",
  "amplitude",
  "market_cap",
  "volume",
  "oi_volume_ratio",
  "funding_rate",
  "score",
  "edge",
  "actions",
] as const;

interface ScreenerTableProps {
  results: ScreenerResult[];
  isLoading: boolean;
  direction: Direction;
}

export const ScreenerTable = memo(function ScreenerTable({
  results,
  isLoading,
  direction,
}: ScreenerTableProps) {
  const t = useTranslations("screener");

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-default">
              {COLUMN_KEYS.map((key) => (
                <th
                  key={key}
                  className="px-3 py-2 text-xs font-medium text-text-secondary whitespace-nowrap text-left"
                >
                  {key === "rank" ? "#" : t(`columns.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-border-default">
                {COLUMN_KEYS.map((key) => (
                  <td key={key} className="px-3 py-3">
                    <Skeleton className="h-4 w-16" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
        <p className="text-sm">{t("no_results")}</p>
      </div>
    );
  }

  const columns: RecordColumn<ScreenerResult>[] = [
    {
      key: "rank",
      header: "#",
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs text-text-secondary">{results.indexOf(row) + 1}</span>
      ),
    },
    {
      key: "symbol",
      header: t("columns.symbol"),
      primary: true,
      // 长币名会把左右两张表撑成不同宽度，这里截断并把全名放进 title
      render: (row) => (
        <span
          className="text-sm font-medium text-text-primary whitespace-nowrap max-w-[8rem] truncate inline-block align-bottom"
          title={row.symbol}
        >
          {row.symbol.replace("-USDT", "")}
        </span>
      ),
    },
    {
      key: "price",
      header: t("columns.price"),
      render: (row) => (
        <span className="text-sm text-text-primary tabular-nums">{formatPrice(row.lastPrice)}</span>
      ),
    },
    {
      key: "change",
      header: t("columns.change"),
      render: (row) => (
        <span
          className={cn(
            "text-sm tabular-nums",
            row.priceChangePercent === null
              ? "text-text-secondary"
              : row.priceChangePercent >= 0
                ? "text-success"
                : "text-danger"
          )}
        >
          {row.priceChangePercent === null ? "-" : formatPercent(row.priceChangePercent)}
        </span>
      ),
    },
    {
      key: "amplitude",
      header: t("columns.amplitude"),
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-text-primary tabular-nums">{row.amplitude.toFixed(1)}%</span>
      ),
    },
    {
      key: "market_cap",
      header: t("columns.market_cap"),
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-text-primary tabular-nums whitespace-nowrap">
          {row.marketCap === null ? "-" : formatCompactUsd(row.marketCap)}
        </span>
      ),
    },
    {
      key: "volume",
      header: t("columns.volume"),
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-text-primary tabular-nums">
          {formatNumber(row.quoteVolume, 0)}
        </span>
      ),
    },
    {
      key: "oi_volume_ratio",
      header: t("columns.oi_volume_ratio"),
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-text-primary tabular-nums">
          {row.oiVolumeRatio === null ? "-" : row.oiVolumeRatio.toFixed(2)}
        </span>
      ),
    },
    {
      key: "funding_rate",
      header: t("columns.funding_rate"),
      hideOnMobile: true,
      render: (row) => (
        <span
          className={cn(
            "text-sm tabular-nums",
            row.fundingRate >= 0 ? "text-success" : "text-danger"
          )}
        >
          {(row.fundingRate * 100).toFixed(4)}%
        </span>
      ),
    },
    {
      key: "score",
      header: t("columns.score"),
      render: (row) => (
        <span
          className={cn(
            "inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold",
            row.score >= 70
              ? "bg-success/20 text-success"
              : row.score >= 40
                ? "bg-gold/20 text-gold"
                : "bg-danger/20 text-danger"
          )}
        >
          {row.score}
        </span>
      ),
    },
    {
      key: "edge",
      header: t("columns.edge"),
      // 优势 = 本方向分 − 反方向分。这一列才是排序依据，score 只说明这个币本身好不好。
      // 两组都只收未取整差值 > 0 的币，所以这里永远不会是负数：显示成 0 只可能是
      // 一个很小的正差值（0 到 0.5）被取整抹平了。那种情况用中性灰，别用红色——
      // 红色会读成"反向"，而它其实只是"优势小到看不出来"。
      render: (row) => (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-8 h-6 rounded px-1 text-xs font-bold",
            row.edge > 0 ? "bg-success/20 text-success" : "text-text-secondary"
          )}
        >
          {row.edge > 0 ? "+" : ""}
          {row.edge}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      render: (row) => (
        <Link href={`/trade?symbol=${row.symbol}&side=${direction}&market=futures`}>
          <Button
            variant={direction === "long" ? "green" : "red"}
            size="sm"
            className="text-xs h-6 px-2"
          >
            {direction === "long" ? t("action_long") : t("action_short")}
          </Button>
        </Link>
      ),
    },
  ];

  return <RecordList rows={results} columns={columns} rowKey={(row) => row.symbol} />;
});
