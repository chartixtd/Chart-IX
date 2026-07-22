"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TradeForm } from "@/components/trade/TradeForm";
import { OrdersPanel } from "@/components/trade/OrdersPanel";
import { OrderBook } from "@/components/trade/OrderBook";
import { cn } from "@/lib/utils";

interface RightPanelProps {
  symbol: string;
}

type Tab = "trade" | "orders" | "book";

export function RightPanel({ symbol }: RightPanelProps) {
  const t = useTranslations("trade");
  const [tab, setTab] = useState<Tab>("trade");

  const tabs: { key: Tab; label: string }[] = [
    { key: "trade", label: t("market.trade") },
    { key: "orders", label: "Orders" },
    { key: "book", label: t("market.order_book") },
  ];

  return (
    <div className="w-64 shrink-0 border-l border-border-default flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-border-default">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 py-2 text-xs font-medium transition-colors",
              tab === key
                ? "text-text-primary border-b border-gold bg-bg-tertiary"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "trade" && <TradeForm symbol={symbol} />}
        {tab === "orders" && <OrdersPanel symbol={symbol} />}
        {tab === "book" && <OrderBook symbol={symbol} />}
      </div>
    </div>
  );
}
