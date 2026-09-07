"use client";

import { useTranslations } from "next-intl";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

const HOT_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT"] as const;

// 一条克制的实时报价——静默的证明，不是交易面板。
function HotQuote({ symbol }: { symbol: string }) {
  const { data: ticker } = useSpotTicker(symbol);
  const base = symbol.split("-")[0];
  const pct = ticker ? parseFloat(ticker.priceChangePercent) : 0;
  const up = pct >= 0;

  return (
    <div className="flex items-baseline gap-3 whitespace-nowrap">
      <span className="font-display text-[13px] font-medium tracking-[0.04em] text-text-primary">{base}</span>
      {ticker ? (
        <>
          <span className="font-mono text-[13px] tabular-nums text-text-secondary">
            {formatPrice(Number(ticker.lastPrice))}
          </span>
          <span className={cn("font-mono text-[11px] tabular-nums", up ? "text-success" : "text-danger")}>
            {formatPercent(pct)}
          </span>
        </>
      ) : (
        <Skeleton className="h-3 w-16" />
      )}
    </div>
  );
}

/**
 * 英雄底部的行情条：四个热门币，发丝竖线分隔。
 * 左侧一枚绿点是唯一的状态点——它传达的是「实时」这个事实。
 */
export function HotCoinsRail() {
  const t = useTranslations("home");
  useBingXWebSocket([...HOT_SYMBOLS]);

  return (
    <div className="flex items-center gap-6 overflow-x-auto sm:gap-10">
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        <span className="eyebrow">{t("market_overview")}</span>
      </span>
      <div className="flex items-center gap-6 sm:gap-10">
        {HOT_SYMBOLS.map((s, i) => (
          <div key={s} className="flex items-center gap-6 sm:gap-10">
            {i > 0 && <span className="hairline-gold-v h-5" />}
            <HotQuote symbol={s} />
          </div>
        ))}
      </div>
      <span className="eyebrow ml-auto hidden shrink-0 md:inline">BingX</span>
    </div>
  );
}
