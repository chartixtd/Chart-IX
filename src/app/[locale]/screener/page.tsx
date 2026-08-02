"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useScreenerData } from "@/hooks/useScreenerData";
import { ScreenerTable } from "@/components/screener/ScreenerTable";
import { Button } from "@/components/ui/Button";
import { SCREENER_REFRESH_MS } from "@/lib/screener-scoring";

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ScreenerPage() {
  const t = useTranslations("screener");
  const { long, short, isLoading, marketCapUnavailable, error, lastUpdated, refetch } =
    useScreenerData();

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = lastUpdated > 0 ? lastUpdated + SCREENER_REFRESH_MS - now : null;

  return (
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("title")}</h1>
          <p className="text-xs text-text-secondary mt-0.5">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {remaining !== null && (
            <span className="text-xs text-text-secondary tabular-nums">
              {t("next_refresh")} {formatCountdown(remaining)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={refetch}>
            {t("refresh_now")}
          </Button>
        </div>
      </div>

      {marketCapUnavailable && (
        <p className="mb-3 rounded-sm border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
          {t("market_cap_unavailable")}
        </p>
      )}

      {error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-secondary">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-border-default bg-bg-primary overflow-hidden">
            <h2 className="border-b border-border-default px-3 py-2 text-sm font-semibold text-success">
              {t("long_group")}
            </h2>
            <ScreenerTable results={long} isLoading={isLoading} direction="long" />
          </section>
          <section className="rounded-lg border border-border-default bg-bg-primary overflow-hidden">
            <h2 className="border-b border-border-default px-3 py-2 text-sm font-semibold text-danger">
              {t("short_group")}
            </h2>
            <ScreenerTable results={short} isLoading={isLoading} direction="short" />
          </section>
        </div>
      )}
    </div>
  );
}
