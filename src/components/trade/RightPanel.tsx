"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TradeForm } from "@/components/trade/TradeForm";
import { OrderBook } from "@/components/trade/OrderBook";
import { cn } from "@/lib/utils";

interface RightPanelProps {
  symbol: string;
}

export function RightPanel({ symbol }: RightPanelProps) {
  const t = useTranslations("trade");
  const [tab, setTab] = useState<"trade" | "book">("trade");

  return (
    <div className="w-64 shrink-0 border-l border-border-default flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-border-default">
        {(["trade", "book"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 py-2 text-xs font-medium transition-colors",
              tab === k
                ? "text-text-primary border-b border-gold bg-bg-tertiary"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {k === "trade" ? t("market.trade") : t("market.order_book")}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "trade" ? (
          <TradeForm symbol={symbol} />
        ) : (
          <OrderBook symbol={symbol} />
        )}
      </div>
    </div>
  );
}
