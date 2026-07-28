"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useScreenerData } from "@/hooks/useScreenerData";
import { ScreenerTable } from "@/components/screener/ScreenerTable";
import { Button } from "@/components/ui/Button";

export default function ScreenerPage() {
  const t = useTranslations("screener");
  const [market, setMarket] = useState<"spot" | "futures">("futures");
  const { results, isLoading, error, refetch } = useScreenerData("long");

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-text-primary">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded bg-bg-tertiary p-0.5">
            <button
              className={`px-3 py-1 text-xs rounded transition-colors ${
                market === "spot" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setMarket("spot")}
            >
              {t("spot")}
            </button>
            <button
              className={`px-3 py-1 text-xs rounded transition-colors ${
                market === "futures" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setMarket("futures")}
            >
              {t("futures")}
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-10 text-text-secondary gap-2">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="rounded-lg border border-border-default bg-bg-primary overflow-hidden">
          <ScreenerTable results={results} isLoading={isLoading} market={market} />
        </div>
      )}
    </div>
  );
}
