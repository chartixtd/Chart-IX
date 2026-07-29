"use client";

import { useTranslations } from "next-intl";
import { formatNumber, formatPrice, cn } from "@/lib/utils";
import type { OrderPreflightPreview } from "@/hooks/useOrderPreflight";
import type { SymbolSpec } from "@/types/trading";

interface OrderPreviewProps {
  preview: OrderPreflightPreview;
  spec: SymbolSpec | undefined;
  baseAsset: string;
  leverage: number;
  showMargin: boolean;
}

export function OrderPreview({ preview, spec, baseAsset, leverage, showMargin }: OrderPreviewProps) {
  const t = useTranslations();
  const { sizing, validation, requiredMarginUsdt, estFee, estLiquidationPrice } = preview;

  if (!sizing || sizing.qty <= 0) return null;

  const rejected = validation && !validation.ok ? validation : null;

  return (
    <div className="space-y-0.5 rounded-xs border border-border-default bg-bg-tertiary p-2 text-xs">
      <Row label={t("trading.est_qty")} value={`${formatNumber(sizing.qty, spec?.quantityPrecision ?? 6)} ${baseAsset}`} />
      <Row label={t("trading.notional")} value={`${formatPrice(sizing.notional)} USDT`} />
      {showMargin && (
        <Row
          label={t("trading.required_margin")}
          value={`${formatPrice(requiredMarginUsdt)} USDT`}
          emphasis
        />
      )}
      {showMargin && estLiquidationPrice !== null && leverage > 1 && (
        <Row label={t("trading.est_liq_price")} value={`≈ ${formatPrice(estLiquidationPrice)}`} />
      )}
      {estFee > 0 && <Row label={t("trading.est_fee")} value={`≈ ${formatPrice(estFee)} USDT`} />}

      {rejected && (
        <p className="mt-1 text-danger">
          {t(`trading.reject.${rejected.reason.toLowerCase()}`, {
            limit: rejected.limit ?? "",
          })}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className={cn("font-mono tabular-nums", emphasis ? "font-semibold text-gold" : "text-text-primary")}>
        {value}
      </span>
    </div>
  );
}
