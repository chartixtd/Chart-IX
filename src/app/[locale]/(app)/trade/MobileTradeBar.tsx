"use client";

import { useTranslations } from "next-intl";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cn } from "@/lib/utils";

export function MobileTradeBar({
  onBuy,
  onSell,
  onTogglePositions,
  onToggleBook,
  bookOpen,
  positionsOpen,
}: {
  onBuy: () => void;
  onSell: () => void;
  onTogglePositions: () => void;
  onToggleBook: () => void;
  bookOpen: boolean;
  positionsOpen: boolean;
}) {
  const t = useTranslations("trade");
  const online = useOnlineStatus();

  return (
    <div className="shrink-0 border-t border-border-default bg-bg-secondary lg:hidden">
      <div className="flex items-stretch divide-x divide-border-default">
        <button
          onClick={onTogglePositions}
          className={cn(
            "min-h-[44px] flex-1 px-3 text-xs transition-colors",
            positionsOpen ? "text-gold" : "text-text-secondary"
          )}
        >
          {t("mobile_positions")}
        </button>
        <button
          onClick={onToggleBook}
          className={cn(
            "min-h-[44px] flex-1 px-3 text-xs transition-colors",
            bookOpen ? "text-gold" : "text-text-secondary"
          )}
        >
          {t("mobile_book")}
        </button>
      </div>

      <div className="flex gap-2 border-t border-border-default p-2">
        <button
          onClick={onBuy}
          disabled={!online}
          className="min-h-[48px] flex-1 rounded-sm bg-success/12 text-sm font-semibold text-success transition-colors active:bg-success/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("mobile_buy")}
        </button>
        <button
          onClick={onSell}
          disabled={!online}
          className="min-h-[48px] flex-1 rounded-sm bg-danger/12 text-sm font-semibold text-danger transition-colors active:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("mobile_sell")}
        </button>
      </div>
    </div>
  );
}
