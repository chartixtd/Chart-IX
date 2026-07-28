"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatNumber, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ScreenerResult } from "@/lib/screener-scoring";

type SortKey = Exclude<keyof ScreenerResult, "symbol">;

interface ScreenerTableProps {
  results: ScreenerResult[];
  isLoading: boolean;
  market: "spot" | "futures";
}

export function ScreenerTable({ results, isLoading, market }: ScreenerTableProps) {
  const t = useTranslations("screener");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      const va = a[sortKey] as number;
      const vb = b[sortKey] as number;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return arr;
  }, [results, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return null;
    return sortDir === "desc" ? " ↓" : " ↑";
  };

  const Th = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="px-3 py-2 text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      {label}{sortIndicator(col)}
    </th>
  );

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-default">
              <Th col="score" label={t("columns.rank")} />
              <th className="px-3 py-2 text-xs font-medium text-text-secondary whitespace-nowrap">
                {t("columns.symbol")}
              </th>
              <Th col="lastPrice" label={t("columns.price")} />
              <Th col="priceChangePercent" label={t("columns.change")} />
              <Th col="amplitude" label={t("columns.amplitude")} />
              <Th col="quoteVolume" label={t("columns.volume")} />
              <Th col="oiVolumeRatio" label={t("columns.oi_volume_ratio")} />
              <Th col="fundingRate" label={t("columns.funding_rate")} />
              <Th col="score" label={t("columns.score")} />
              <th className="px-3 py-2 text-xs font-medium text-text-secondary">{t("columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-border-default">
                {Array.from({ length: 10 }).map((_, j) => (
                  <td key={j} className="px-3 py-3">
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
        <thead>
          <tr className="border-b border-border-default sticky top-0 bg-bg-primary z-10">
            <Th col="score" label="#" />
            <th className="px-3 py-2 text-xs font-medium text-text-secondary whitespace-nowrap">
              {t("columns.symbol")}
            </th>
            <Th col="lastPrice" label={t("columns.price")} />
            <Th col="priceChangePercent" label={t("columns.change")} />
            <Th col="amplitude" label={t("columns.amplitude")} />
            <Th col="quoteVolume" label={t("columns.volume")} />
            <Th col="oiVolumeRatio" label={t("columns.oi_volume_ratio")} />
            <Th col="fundingRate" label={t("columns.funding_rate")} />
            <Th col="score" label={t("columns.score")} />
            <th className="px-3 py-2 text-xs font-medium text-text-secondary">{t("columns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
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
              <td className={cn(
                "px-3 py-2.5 text-sm tabular-nums",
                row.priceChangePercent >= 0 ? "text-green" : "text-red"
              )}>
                {formatPercent(row.priceChangePercent)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.amplitude.toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatNumber(row.quoteVolume)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.oiVolumeRatio.toFixed(2)}
              </td>
              <td className={cn(
                "px-3 py-2.5 text-sm tabular-nums",
                row.fundingRate >= 0 ? "text-green" : "text-red"
              )}>
                {(row.fundingRate * 100).toFixed(4)}%
              </td>
              <td className="px-3 py-2.5 text-sm">
                <span className={cn(
                  "inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold",
                  row.score >= 70 ? "bg-green/20 text-green" :
                  row.score >= 40 ? "bg-gold/20 text-gold" :
                  "bg-red/20 text-red"
                )}>
                  {row.score}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1">
                  <Link href={`/trade?symbol=${row.symbol}&side=long&market=${market}`}>
                    <Button variant="outline" size="sm" className="text-green border-green/50 hover:bg-green/10 text-xs h-6 px-2">
                      {t("action_long")}
                    </Button>
                  </Link>
                  <Link href={`/trade?symbol=${row.symbol}&side=short&market=${market}`}>
                    <Button variant="outline" size="sm" className="text-red border-red/50 hover:bg-red/10 text-xs h-6 px-2">
                      {t("action_short")}
                    </Button>
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
