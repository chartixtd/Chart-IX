"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
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
  "actions",
] as const;

interface ScreenerTableProps {
  results: ScreenerResult[];
  isLoading: boolean;
  direction: Direction;
}

export function ScreenerTable({ results, isLoading, direction }: ScreenerTableProps) {
  const t = useTranslations("screener");

  const header = (
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
  );

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          {header}
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        {header}
        <tbody>
          {results.map((row, idx) => (
            <tr
              key={row.symbol}
              className="border-b border-border-default hover:bg-bg-tertiary transition-colors"
            >
              <td className="px-3 py-2.5 text-xs text-text-secondary">{idx + 1}</td>
              <td className="px-3 py-2.5 text-sm font-medium text-text-primary whitespace-nowrap">
                {row.symbol.replace("-USDT", "")}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatPrice(row.lastPrice)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-sm tabular-nums",
                  row.priceChangePercent === null
                    ? "text-text-secondary"
                    : row.priceChangePercent >= 0
                      ? "text-success"
                      : "text-danger"
                )}
              >
                {row.priceChangePercent === null ? "-" : formatPercent(row.priceChangePercent)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.amplitude.toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums whitespace-nowrap">
                {row.marketCap === null ? "-" : formatCompactUsd(row.marketCap)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatNumber(row.quoteVolume, 0)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.oiVolumeRatio.toFixed(2)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-sm tabular-nums",
                  row.fundingRate >= 0 ? "text-success" : "text-danger"
                )}
              >
                {(row.fundingRate * 100).toFixed(4)}%
              </td>
              <td className="px-3 py-2.5 text-sm">
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
              </td>
              <td className="px-3 py-2.5">
                <Link href={`/trade?symbol=${row.symbol}&side=${direction}&market=futures`}>
                  <Button
                    variant={direction === "long" ? "green" : "red"}
                    size="sm"
                    className="text-xs h-6 px-2"
                  >
                    {direction === "long" ? t("action_long") : t("action_short")}
                  </Button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
