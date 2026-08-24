"use client";

import { useTranslations } from "next-intl";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

const HOT_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT"] as const;

// A restrained live quote — silent proof, not a trading panel.
function HotQuote({ symbol }: { symbol: string }) {
  const { data: ticker } = useSpotTicker(symbol);
  const base = symbol.split("-")[0];
  const pct = ticker ? parseFloat(ticker.priceChangePercent) : 0;
  const up = pct >= 0;

  return (
    <div className="flex items-baseline gap-2.5 whitespace-nowrap">
      <span className="font-display text-sm tracking-tight text-text-primary">{base}</span>
      {ticker ? (
        <>
          <span className="font-mono text-sm tabular-nums text-text-secondary">
            {formatPrice(Number(ticker.lastPrice))}
          </span>
          <span className={cn("font-mono text-xs tabular-nums", up ? "text-success" : "text-danger")}>
            {formatPercent(pct)}
          </span>
        </>
      ) : (
        <Skeleton className="h-3 w-16 rounded-xs" />
      )}
    </div>
  );
}

// Full-width quote rail across the top of the hero — a private-bank ticker,
// four hot pairs only, hairline-separated.
export function HotCoinsRail() {
  const t = useTranslations("home");
  useBingXWebSocket([...HOT_SYMBOLS]);

  return (
    <div className="flex items-center gap-5 overflow-x-auto sm:gap-8">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
        {t("market_overview")}
      </span>
      <div className="flex items-center gap-5 sm:gap-7">
        {HOT_SYMBOLS.map((s, i) => (
          <div key={s} className="flex items-center gap-5 sm:gap-7">
            {i > 0 && <span className="h-4 w-px bg-border-default" />}
            <HotQuote symbol={s} />
          </div>
        ))}
      </div>
      <span className="ml-auto hidden shrink-0 text-[10px] uppercase tracking-[0.18em] text-text-muted md:inline">
        BingX · Live
      </span>
    </div>
  );
}
